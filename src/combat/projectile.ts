/**
 * 妖气弹（投射物）：第三阶段真实 gameplay 投射物。
 *
 * - 由远程敌人在 FIRE 状态生成，朝玩家危险区域飞行；
 * - 每帧由 CombatEngine 统一推进，出屏/超时销毁；
 * - 玩家有效剑痕的整段轨迹与弹体做「点到圆最近距离」碰撞（快速穿透必命中）；
 * - 一次性结算：斩碎（slashed）或命中玩家（resolved）后立即从可碰撞集合移除，
 *   同一剑不能重复斩同一枚弹，命中玩家只扣一次护体真气。
 */
import type { SlashPoint } from './slashDetect';

export interface Projectile {
  id: number;
  /** 舞台比例坐标 */
  x: number;
  y: number;
  /** 速度向量（舞台比例/秒） */
  vx: number;
  vy: number;
  /** 半径（× 舞台宽） */
  radiusRatio: number;
  /** 未斩碎命中玩家的护体真气伤害 */
  damage: number;
  createdAt: number;
  /** 生命周期截止时间（ms） */
  deadline: number;
  /** 已被剑痕斩碎 */
  slashed: boolean;
  /** 已命中玩家（结算过护体真气） */
  resolved: boolean;
  /** 结算/销毁时间（渲染碎裂/命中反馈用） */
  resolvedAt: number;
  /** 出生位置（渲染拖尾残影用） */
  fromX: number;
  fromY: number;
}

let nextId = 1;
export function resetProjectileIds(): void {
  nextId = 1;
}

/**
 * 创建一枚妖气弹：从敌人位置朝目标点（玩家危险区）直线飞行。
 * @returns 半径为舞台比例，速度方向指向目标
 */
export function createProjectile(
  fromX: number,
  fromY: number,
  targetX: number,
  targetY: number,
  nowMs: number,
  cfg: { radiusRatio: number; speedRatio: number; damage: number; lifeMs: number },
): Projectile {
  const dx = targetX - fromX;
  const dy = targetY - fromY;
  const len = Math.max(1e-6, Math.hypot(dx, dy));
  const speed = cfg.speedRatio;
  return {
    id: nextId++,
    x: fromX,
    y: fromY,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    radiusRatio: cfg.radiusRatio,
    damage: cfg.damage,
    createdAt: nowMs,
    deadline: nowMs + cfg.lifeMs,
    slashed: false,
    resolved: false,
    resolvedAt: 0,
    fromX,
    fromY,
  };
}

/** 每帧推进；返回 false 表示应销毁（出屏/超时/已结算） */
export function updateProjectile(p: Projectile, dtMs: number, nowMs: number): boolean {
  if (p.slashed || p.resolved) return false;
  const dtSec = dtMs / 1000;
  p.x += p.vx * dtSec;
  p.y += p.vy * dtSec;
  // 出屏（留 0.15 裕量）或超时销毁；不依赖固定舞台尺寸
  if (p.x < -0.15 || p.x > 1.15 || p.y < -0.15 || p.y > 1.15) return false;
  if (nowMs > p.deadline) return false;
  return true;
}

/**
 * 点到线段的最近距离（标准投影钳制）。
 */
export function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * 剑痕整段轨迹与弹体圆形碰撞：线段到圆最近距离检测。
 * 相邻轨迹点构成线段，逐段计算到圆心的最近距离——
 * 高速剑痕单帧跨越弹体（采样点跳过弹体）也不会漏判。
 */
export function segmentHitsProjectile(
  points: SlashPoint[],
  p: Projectile,
  stageW: number,
  stageH: number,
): boolean {
  const r = p.radiusRatio * stageW;
  const cx = p.x * stageW;
  const cy = p.y * stageH;
  for (let i = 0; i < points.length; i++) {
    const q = points[i];
    if (Math.hypot(q.x - cx, q.y - cy) <= r) return true;
    if (i > 0) {
      const prev = points[i - 1];
      if (pointToSegmentDist(cx, cy, prev.x, prev.y, q.x, q.y) <= r) return true;
    }
  }
  return false;
}

/**
 * 整段轨迹到某圆心（px 坐标）的最近距离：线段检测版本。
 * 用于狼/远程敌人身体与弱点的碰撞（快速穿透不漏判）。
 */
export function segmentMinDistToPoint(
  points: SlashPoint[],
  cx: number,
  cy: number,
): number {
  let m = Infinity;
  for (let i = 0; i < points.length; i++) {
    const q = points[i];
    m = Math.min(m, Math.hypot(q.x - cx, q.y - cy));
    if (i > 0) {
      const prev = points[i - 1];
      m = Math.min(m, pointToSegmentDist(cx, cy, prev.x, prev.y, q.x, q.y));
    }
  }
  return m;
}

/** 剑尖是否在弹体内（渲染提示用，不作命中判定） */
export function pointInProjectile(
  x: number,
  y: number,
  p: Projectile,
  stageW: number,
  stageH: number,
): boolean {
  const r = p.radiusRatio * stageW;
  return Math.hypot(x - p.x * stageW, y - p.y * stageH) <= r;
}

/** 弹体是否到达玩家命中区（舞台比例中心圆，半径 stageRatio） */
export function projectileReachedPlayer(
  p: Projectile,
  playerX: number,
  playerY: number,
  hitRadiusStage: number,
): boolean {
  return Math.hypot(p.x - playerX, p.y - playerY) <= hitRadiusStage;
}

/** 标记斩碎（一次性）：已斩碎的弹不再参与任何碰撞 */
export function slashProjectile(p: Projectile, nowMs: number): void {
  if (p.slashed || p.resolved) return;
  p.slashed = true;
  p.resolvedAt = nowMs;
}

/** 标记命中玩家（一次性）：结算护体真气后立即移除出可碰撞集合 */
export function resolveProjectileHit(p: Projectile, nowMs: number): void {
  if (p.slashed || p.resolved) return;
  p.resolved = true;
  p.resolvedAt = nowMs;
}
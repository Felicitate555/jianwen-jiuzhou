/**
 * 远程敌人（妖修）：第三阶段唯一远程怪。
 *
 * 状态机：ENTER → CHARGE → FIRE → RECOVER →（下一轮）CHARGE… → DYING → DEAD
 * 被弱点击中时进入 INTERRUPTED（破势）：短暂硬直、取消本次发射，随后 RECOVER。
 *
 * - 蓄力（CHARGE）期间身体中央显示弱点核心（weakPointActive）；
 * - 普通身体命中产生受击反馈但不打断蓄力；
 * - 弱点判定：CHARGE 状态 + 轨迹与弱点几何相交 + accuracyScore ≥ 阈值（由引擎判定）；
 * - 同一次蓄力弱点只触发一次 INTERRUPTED；
 * - 时间推进全部基于引擎传入的 nowMs/dtMs，无独立计时器/异步回调，
 *   敌人死亡、重试、页面重开时由引擎重建实例，旧计时自然失效。
 */
import type { RangedEnemyConfig } from './combatConfig';

export type RangedEnemyState =
  | 'ENTER'
  | 'CHARGE'
  | 'FIRE'
  | 'RECOVER'
  | 'INTERRUPTED'
  | 'DYING'
  | 'DEAD';

export interface RangedEnemy {
  state: RangedEnemyState;
  hp: number;
  hpMax: number;
  /** 舞台比例坐标 */
  x: number;
  y: number;
  /** 入场目标 */
  holdX: number;
  /** 本次蓄力开始时间 */
  chargeStartedAt: number;
  /** 本次蓄力结束（发射）时间 */
  chargeEndsAt: number;
  /** 蓄力前摇结束时间（前摇后才暴露弱点） */
  windupUntil: number;
  /** 弱点当前是否有效（仅 CHARGE 且过了前摇） */
  weakPointActive: boolean;
  /** 破势硬直截止 */
  interruptedUntil: number;
  /** 上一次发射时间 */
  lastFireAt: number;
  /** 已完成发射轮数 */
  cycles: number;
  /** 轮数上限（快照用途：渲染层区分「击杀」与「三轮耗尽退场」，不改状态机） */
  maxCycles: number;
  /** 本次蓄力是否已被打断（防重复打断） */
  chargeInterrupted: boolean;
  /** 本次蓄力是否已发射（防重复发射） */
  chargeFired: boolean;
  /** 受击白闪截止 */
  hitFlashUntil: number;
  /** 死亡反馈 */
  dyingAt: number;
  dyingDuration: number;
  /** 当前 RECOVER 段的起始时间 */
  recoverFrom: number;
}

export function createRangedEnemy(cfg: RangedEnemyConfig): RangedEnemy {
  return {
    state: 'ENTER',
    hp: cfg.hpMax,
    hpMax: cfg.hpMax,
    x: cfg.spawnX,
    y: 0.32,
    holdX: cfg.holdX,
    chargeStartedAt: 0,
    chargeEndsAt: 0,
    windupUntil: 0,
    weakPointActive: false,
    interruptedUntil: 0,
    lastFireAt: 0,
    cycles: 0,
    maxCycles: cfg.maxCycles,
    chargeInterrupted: false,
    chargeFired: false,
    hitFlashUntil: 0,
    dyingAt: 0,
    dyingDuration: cfg.dyingMs,
    recoverFrom: 0,
  };
}

/**
 * 推进远程敌人状态（原地更新）。
 * @param dtMs 距上次 update 的毫秒数（引擎已 clamp ≤100ms）
 * @param canCharge 场上是否允许开始新蓄力（引擎传入：场上无活跃妖气弹才允许，
 *                  保证「每次只允许一枚在场妖气弹」的克制编排）
 */
export function updateRangedEnemy(
  e: RangedEnemy,
  nowMs: number,
  dtMs: number,
  cfg: RangedEnemyConfig,
  canCharge: boolean,
): boolean {
  if (e.state === 'DEAD' || e.state === 'DYING') {
    if (e.state === 'DYING' && nowMs >= e.dyingAt) e.state = 'DEAD';
    return false;
  }

  // 弱点仅在 CHARGE 且过了前摇时有效
  e.weakPointActive =
    e.state === 'CHARGE' && !e.chargeInterrupted && nowMs >= e.windupUntil;

  switch (e.state) {
    case 'ENTER': {
      const speed = cfg.enterSpeedRatio;
      e.x -= (speed * dtMs) / 1000;
      if (e.x <= e.holdX) {
        e.x = e.holdX;
        // 入场完毕即开始蓄力
        startCharge(e, nowMs, cfg);
      }
      return false;
    }
    case 'CHARGE': {
      if (e.chargeInterrupted) return false;
      if (nowMs >= e.chargeEndsAt) {
        // 蓄力完成 → FIRE（引擎检测到后发射一枚妖气弹）
        e.state = 'FIRE';
        e.chargeFired = false;
      }
      return false;
    }
    case 'FIRE': {
      // 引擎在检测到 state === 'FIRE' 且未发射时发射一次并调用 markFired
      return false;
    }
    case 'INTERRUPTED': {
      if (nowMs >= e.interruptedUntil) {
        // 打断不算完成一轮发射，硬直后进入恢复
        e.state = 'RECOVER';
        e.recoverFrom = nowMs;
      }
      return false;
    }
    case 'RECOVER': {
      if (nowMs >= e.recoverFrom + cfg.recoverMs) {
        if (e.cycles >= cfg.maxCycles) {
          // 达到轮数上限：敌人收势离场（威胁解除）
          e.state = 'DYING';
          e.dyingAt = nowMs + cfg.dyingMs;
          return false;
        }
        if (canCharge) startCharge(e, nowMs, cfg);
        // 场上仍有妖气弹时原地等待，不开始新蓄力
      }
      return false;
    }
  }
  return false;
}

/** 开始一次新的蓄力（前摇后才暴露弱点） */
function startCharge(e: RangedEnemy, nowMs: number, cfg: RangedEnemyConfig): void {
  e.state = 'CHARGE';
  e.chargeStartedAt = nowMs;
  e.windupUntil = nowMs + cfg.chargeWindupMs;
  e.chargeEndsAt = nowMs + cfg.chargeWindupMs + cfg.chargeMs;
  e.chargeInterrupted = false;
  e.chargeFired = false;
}

/** 引擎发射回调：FIRE 状态确认发射后标记，防止重复发射 */
export function markFired(e: RangedEnemy, nowMs: number): void {
  if (e.state !== 'FIRE' || e.chargeFired) return;
  e.chargeFired = true;
  e.lastFireAt = nowMs;
  e.cycles++;
}

/** 发射完成后由引擎转入 RECOVER */
export function toRecover(e: RangedEnemy, nowMs: number): void {
  if (e.state !== 'FIRE') return;
  e.state = 'RECOVER';
  e.recoverFrom = nowMs;
}

/** 普通身体受击：白闪 + 伤害（不打断蓄力，不触发 INTERRUPTED） */
export function rangedEnemyHit(e: RangedEnemy, nowMs: number, damage: number): void {
  if (e.state === 'DEAD' || e.state === 'DYING') return;
  e.hp = Math.max(0, e.hp - damage);
  e.hitFlashUntil = nowMs + 200;
  if (e.hp <= 0) {
    e.state = 'DYING';
    e.dyingAt = nowMs + e.dyingDuration;
    e.weakPointActive = false;
  }
}

/** 弱点破势：只在 CHARGE、未被本剑结算过时触发一次 */
export function rangedEnemyInterrupt(e: RangedEnemy, nowMs: number, cfg: RangedEnemyConfig): void {
  if (e.state !== 'CHARGE' || e.chargeInterrupted) return;
  e.chargeInterrupted = true;
  e.weakPointActive = false;
  e.state = 'INTERRUPTED';
  e.interruptedUntil = nowMs + cfg.interruptedMs;
}

/** 死亡推进（引擎在 hp<=0 时调用 rangedEnemyHit 已处理） */
export function rangedEnemyDie(e: RangedEnemy, nowMs: number): void {
  if (e.state === 'DEAD') return;
  e.state = 'DYING';
  e.dyingAt = nowMs + e.dyingDuration;
  e.hp = 0;
  e.weakPointActive = false;
}

/** 弱点中心（舞台比例） */
export function weakPointCenter(e: RangedEnemy): { x: number; y: number } {
  return { x: e.x, y: e.y };
}
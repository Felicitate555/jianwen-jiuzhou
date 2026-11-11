/**
 * 第九阶段：赤瞳山魈（第一章综合终局 Boss）。
 *
 * 三阶段复用既有战斗积木，不引入新底层机制：
 * - 试剑（TRIAL_SWORD）：复用 wolf 近身/预警/扑击/收势格挡节奏；
 * - 破势（BREAK_STANCE）：复用 rangedEnemy 蓄力弱点 + projectile 妖气弹；
 * - 乱战（CHAOS）：组合扑击与妖气弹（有限上限），考验三式剑招。
 *
 * 阶段由 HP 阈值驱动（combatConfig.boss 可调）；
 * 死亡后停止全部攻击与投射物生成（由引擎编排层保证，本模块只提供状态）。
 */
import type { Wolf } from './wolf';
import type { RangedEnemy } from './rangedEnemy';
import type { RangedEnemyConfig, WolfConfig } from './combatConfig';

/** Boss 遭遇固定 id（第一章赤瞳山魈） */
export const BOSS_ENCOUNTER_ID = 'chapter1_red_eye_ape';

export type BossPhaseName = 'TRIAL_SWORD' | 'BREAK_STANCE' | 'CHAOS';

export const BOSS_PHASE_TEXT: Record<BossPhaseName, string> = {
  TRIAL_SWORD: '试剑',
  BREAK_STANCE: '破势',
  CHAOS: '乱战',
};

/** Boss 阶段开场提示文案（克制，一行） */
export const BOSS_PHASE_LEAD: Record<BossPhaseName, string> = {
  TRIAL_SWORD: '赤瞳山魈压境 · 收势可格其扑击',
  BREAK_STANCE: '山魈退开蓄力 · 剑穿其目可破势',
  CHAOS: '妖气乱走 · 三式剑招正其时',
};

export interface BossConfig {
  /** Boss 总生命（不做 5000 磨血；正常几次有效命中 60~90s 完成） */
  hpMax: number;
  /** 进入破势阶段的 HP 百分比阈值（< 此值转 BREAK_STANCE） */
  phase2HpPct: number;
  /** 进入乱战阶段的 HP 百分比阈值 */
  phase3HpPct: number;
  /** 身体碰撞半径（× 舞台宽，大于山狼） */
  bodyRadiusRatio: number;
  /** 弱点半径（× 身体半径；破势阶段蓄力时暴露） */
  weakPointRadiusRatio: number;
  /** 试剑阶段出生 x（舞台比例，屏幕右侧外） */
  spawnX: number;
  /** 试剑阶段危险区 x（到达后进入预警） */
  dangerX: number;
  /** 逼近速度（× 舞台宽/秒） */
  approachSpeedRatio: number;
  /** 预警停顿时长（ms，可读预警窗口） */
  telegraphMs: number;
  /** 扑击时长（ms） */
  lungeDurationMs: number;
  /** 扑击目标点（玩家剑位，舞台比例） */
  lungeTargetX: number;
  lungeTargetY: number;
  /** 扑击后退场速度（× 舞台宽/秒） */
  recoverSpeedRatio: number;
  /** 扑击命中未收势的护体真气损失 */
  lungeDamage: number;
  /** 收势但气机不足时护剑被破的护体真气损失 */
  blockBreakDamage: number;
  /** 死亡反馈时长（ms） */
  dyingMs: number;
  /** 破势阶段停留位置 x（舞台比例，远侧） */
  rangeHoldX: number;
  /** 破势/乱战阶段蓄力时长（ms） */
  chargeMs: number;
  /** 蓄力前摇（ms；过摇后暴露弱点） */
  chargeWindupMs: number;
  /** 弱点破势所需最低准确分（0~100） */
  weakPointAccuracyThreshold: number;
  /** 被破势后的硬直（ms） */
  interruptedMs: number;
  /** 发射后恢复时长（ms） */
  recoverMs: number;
  /** 乱战阶段妖气弹同时在场上限 */
  chaosProjectileCap: number;
  /** 乱战阶段扑击间隔下限（ms） */
  chaosLungeGapMs: number;
  /** 未斩碎命中玩家的妖气弹伤害（护体真气） */
  projectileDamage: number;
  /** 未打断时重击释放的伤害（护剑不能完全挡住） */
  unblockedBlastDamage: number;
}

export interface Boss {
  /** 当前阶段 */
  phase: BossPhaseName;
  /** 生命（共享单条；阶段由百分比阈值驱动） */
  hp: number;
  hpMax: number;
  /** 舞台比例坐标（近身阶段由 wolf 语义驱动；破势阶段悬停远侧） */
  x: number;
  y: number;
  /** 复用 wolf 状态机的近身行为（试剑/乱战扑击） */
  melee: Wolf;
  /** 复用 ranged 状态机的蓄力/发射行为（破势/乱战） */
  ranged: RangedEnemy;
  /** 破势阶段：本次蓄力是否已发射（防重复重击） */
  blastFired: boolean;
  /** 破势阶段：本次蓄力是否已被打断 */
  chargeInterrupted: boolean;
  /** 弱点当前是否有效（破势/乱战蓄力且过前摇） */
  weakPointActive: boolean;
  /** 阶段切换时刻（开场提示用） */
  phaseSince: number;
  /** 死亡反馈截止（DYING → DEAD） */
  dyingAt: number;
  dyingDuration: number;
  /** 乱战阶段上次扑击发起时间 */
  lastChaosLungeAt: number;
  /** 乱战阶段已发射妖气弹计数（节奏控制） */
  chaosFiredCount: number;
  /** 受击白闪截止 */
  hitFlashUntil: number;
  /** 通用状态（DEAD 前）—— 由 melee/ranged 派生或 DEAD */
  state: 'ALIVE' | 'DYING' | 'DEAD';
}

/** 从 BossConfig 派生 wolf 子配置（试剑行为参数同源） */
export function bossWolfConfig(cfg: BossConfig): WolfConfig {
  return {
    hpMax: cfg.hpMax,
    bodyRadiusRatio: cfg.bodyRadiusRatio,
    coreRadiusRatio: 0.42,
    spawnX: cfg.spawnX,
    dangerX: cfg.dangerX,
    approachSpeedRatio: cfg.approachSpeedRatio,
    telegraphMs: cfg.telegraphMs,
    lungeDurationMs: cfg.lungeDurationMs,
    lungeTargetX: cfg.lungeTargetX,
    lungeTargetY: cfg.lungeTargetY,
    recoverSpeedRatio: cfg.recoverSpeedRatio,
    dyingMs: cfg.dyingMs,
    lungeDamage: cfg.lungeDamage,
    blockBreakDamage: cfg.blockBreakDamage,
  };
}

/** 从 BossConfig 派生 ranged 子配置（破势行为参数同源） */
export function bossRangedConfig(cfg: BossConfig, rangedCfg: RangedEnemyConfig): RangedEnemyConfig {
  return {
    ...rangedCfg,
    hpMax: cfg.hpMax, // 生命共享：伤害统一记到 Boss 单条 HP
    weakPointRadiusRatio: cfg.weakPointRadiusRatio,
    weakPointAccuracyThreshold: cfg.weakPointAccuracyThreshold,
    chargeMs: cfg.chargeMs,
    chargeWindupMs: cfg.chargeWindupMs,
    interruptedMs: cfg.interruptedMs,
    recoverMs: cfg.recoverMs,
    maxCycles: 99, // 阶段由 HP 驱动，不用轮数上限
  };
}

export function createBoss(cfg: BossConfig, _rangedCfg: RangedEnemyConfig, nowMs: number): Boss {
  const wolf = {
    state: 'APPROACH' as const,
    hp: cfg.hpMax,
    hpMax: cfg.hpMax,
    x: cfg.spawnX,
    y: 0.5,
    telegraphUntil: 0,
    lungeStart: 0,
    lungeResolveAt: 0,
    lungeFromX: 0,
    lungeFromY: 0,
    dyingAt: 0,
    hitFlashUntil: 0,
    knockback: 0,
    lungeResolved: false,
    dyingDuration: cfg.dyingMs,
  };
  const ranged = {
    state: 'ENTER' as const,
    hp: cfg.hpMax,
    hpMax: cfg.hpMax,
    x: cfg.rangeHoldX,
    y: 0.32,
    holdX: cfg.rangeHoldX,
    chargeStartedAt: 0,
    chargeEndsAt: 0,
    windupUntil: 0,
    weakPointActive: false,
    interruptedUntil: 0,
    lastFireAt: 0,
    cycles: 0,
    maxCycles: 99,
    chargeInterrupted: false,
    chargeFired: false,
    hitFlashUntil: 0,
    dyingAt: 0,
    dyingDuration: cfg.dyingMs,
    recoverFrom: 0,
  };
  return {
    phase: 'TRIAL_SWORD',
    hp: cfg.hpMax,
    hpMax: cfg.hpMax,
    x: cfg.spawnX,
    y: 0.5,
    melee: wolf,
    ranged,
    blastFired: false,
    chargeInterrupted: false,
    weakPointActive: false,
    phaseSince: nowMs,
    dyingAt: 0,
    dyingDuration: cfg.dyingMs,
    lastChaosLungeAt: 0,
    chaosFiredCount: 0,
    hitFlashUntil: 0,
    state: 'ALIVE',
  };
}

/** HP 百分比 → 应处阶段（纯函数；阈值驱动，不依赖时间） */
export function bossPhaseForHp(hp: number, hpMax: number, cfg: BossConfig): BossPhaseName {
  const pct = hpMax > 0 ? hp / hpMax : 0;
  if (pct <= cfg.phase3HpPct) return 'CHAOS';
  if (pct <= cfg.phase2HpPct) return 'BREAK_STANCE';
  return 'TRIAL_SWORD';
}

/** Boss 受击（统一单条 HP；死亡判定由引擎做） */
export function bossHit(b: Boss, damage: number, nowMs: number): void {
  b.hp = Math.max(0, b.hp - damage);
  b.melee.hp = b.hp;
  b.ranged.hp = b.hp;
  b.hitFlashUntil = nowMs + 220;
  b.melee.hitFlashUntil = nowMs + 220;
  b.ranged.hitFlashUntil = nowMs + 220;
  // 击退（近身阶段）
  b.melee.knockback = Math.min(0.05, b.melee.knockback + 0.02);
}

/** Boss 进入死亡反馈（停止一切攻击/蓄力/发射） */
export function bossDie(b: Boss, nowMs: number): void {
  b.state = 'DYING';
  b.hp = 0;
  b.melee.hp = 0;
  b.ranged.hp = 0;
  b.melee.state = 'DEAD';
  b.ranged.state = 'DEAD';
  b.weakPointActive = false;
  b.dyingAt = nowMs + b.dyingDuration;
}

/** 推进死亡反馈（DYING → DEAD） */
export function updateBossDying(b: Boss, nowMs: number): void {
  if (b.state === 'DYING' && nowMs >= b.dyingAt) {
    b.state = 'DEAD';
  }
}

/** 生成唯一 battleId（每次挑战一条；同 encounter 下永不重复） */
let battleSeq = 0;
export function newBattleId(): string {
  battleSeq += 1;
  const c = globalThis.crypto;
  const rand =
    c && typeof c.getRandomValues === 'function'
      ? (() => {
          const buf = new Uint32Array(1);
          c.getRandomValues(buf);
          return buf[0].toString(36);
        })()
      : Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${BOSS_ENCOUNTER_ID}:${Date.now().toString(36)}:${battleSeq.toString(36)}:${rand}`;
}
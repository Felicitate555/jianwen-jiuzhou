/**
 * 第二轮战斗层可配置参数。
 * 速度/长度阈值均按「舞台宽度比例」归一化，不受屏幕尺寸影响；
 * 最大可控剑速（maxControllableRatio）为当前练气阶段参数，后续阶段可调。
 */
import { DEFAULT_BOSS_RHYTHM_CONFIG } from './bossRhythmGate';

export interface SlashConfig {
  /** 有效斩击最小路径长度（× 舞台宽） */
  minPathRatio: number;
  /** 有效斩击最低平均速度（× 舞台宽/秒） */
  minAvgSpeedRatio: number;
  /** 单个斩击轨迹段的最大时长（ms），超过即关闭作废 */
  segmentWindowMs: number;
  /** 剑尖停顿多久（ms）判定当前段结束 */
  segmentIdleCloseMs: number;
}

export interface SpeedConfig {
  /** 低于该速度（× 舞台宽/秒）为「太慢」：剑气不足、低伤害 */
  slowRatio: number;
  /** 达到该速度进入「凝练」：较高伤害 */
  goodRatio: number;
  /** 最大可控剑速（× 舞台宽/秒）：超过即「剑势失控」 */
  maxControllableRatio: number;
}

export interface WolfConfig {
  hpMax: number;
  /** 身体碰撞半径（× 舞台宽） */
  bodyRadiusRatio: number;
  /** 核心命中区半径（× 身体半径） */
  coreRadiusRatio: number;
  /** 出生点 x（舞台比例，屏幕右侧外） */
  spawnX: number;
  /** 危险区域 x（舞台比例）：到达后进入预警 */
  dangerX: number;
  /** 逼近速度（× 舞台宽/秒） */
  approachSpeedRatio: number;
  /** 预警停顿时长（ms） */
  telegraphMs: number;
  /** 扑击时长（ms） */
  lungeDurationMs: number;
  /** 扑击目标点（玩家剑位，舞台比例） */
  lungeTargetX: number;
  lungeTargetY: number;
  /** 扑击后退场速度（× 舞台宽/秒） */
  recoverSpeedRatio: number;
  /** 死亡反馈时长（ms） */
  dyingMs: number;
  /** 扑击命中未收势的护体真气损失 */
  lungeDamage: number;
  /** 收势但气机不足时护剑被破的护体真气损失 */
  blockBreakDamage: number;
}

export interface PlayerConfig {
  qiMax: number;
  guardQiMax: number;
  /** 收势（SHEATHED）时气机恢复速度（点/秒） */
  qiRegenPerSec: number;
  /** 低于该气机为「气机不继」：伤害大幅降低、剑气视觉变弱 */
  qiExhaustedThreshold: number;
  /** 气机不继时的伤害倍率 */
  exhaustedDamageMul: number;
  /** 每次有效斩击的基础气机消耗 */
  slashQiCostBase: number;
  /** 按斩击路径长度（× 舞台宽）追加的气机消耗 */
  slashQiCostPerPathRatio: number;
  /** 单次斩击气机消耗上限 */
  slashQiCostMax: number;
  /** 剑势失控时的额外气机消耗 */
  outOfControlExtraQiCost: number;
  /** 护剑（收势格挡）消耗的气机 */
  blockQiCost: number;
  /** 护剑成功时护体真气的少量损失（0 = 不损失） */
  blockChipDamage: number;
}

export interface DamageConfig {
  /** 基础伤害 */
  base: number;
  accuracyFactorMin: number;
  accuracyFactorMax: number;
  stabilityFactorMin: number;
  stabilityFactorMax: number;
}

export interface RangedEnemyConfig {
  hpMax: number;
  /** 身体碰撞半径（× 舞台宽） */
  bodyRadiusRatio: number;
  /** 弱点核心半径（× 身体半径，远小于身体，防擦边误判） */
  weakPointRadiusRatio: number;
  /** 弱点命中所需的最低准确度分（0～100） */
  weakPointAccuracyThreshold: number;
  /** 出生点（舞台比例，屏幕右侧外） */
  spawnX: number;
  /** 停留位置（舞台比例，远侧悬浮） */
  holdX: number;
  /** 入场速度（× 舞台宽/秒） */
  enterSpeedRatio: number;
  /** 蓄力时长（ms） */
  chargeMs: number;
  /** 蓄力开始前的间隔（ms） */
  chargeWindupMs: number;
  /** 发射后的恢复时长（ms） */
  recoverMs: number;
  /** 被破势后的硬直时长（ms） */
  interruptedMs: number;
  /** 一次试炼最多发射轮数 */
  maxCycles: number;
  /** 死亡反馈时长（ms） */
  dyingMs: number;
  /** 山狼死亡后延迟多久出现（ms） */
  spawnDelayMs: number;
}

export interface ProjectileConfig {
  /** 妖气弹半径（× 舞台宽） */
  radiusRatio: number;
  /** 飞行速度（× 舞台宽/秒） */
  speedRatio: number;
  /** 未斩碎命中玩家的护体真气伤害 */
  damage: number;
  /** 最大飞行时长（ms），超时销毁（防永久滞留） */
  lifeMs: number;
  /** 玩家命中区半径（× 舞台宽，以玩家危险区中心为圆心） */
  playerHitRadiusRatio: number;
  /** 妖气弹可以被格挡吗？（本轮：不可，必须斩碎或承受） */
  blockable: boolean;
  /** 斩碎妖气弹的气机消耗（克制） */
  slashCost: number;
  /** 弱点破势（打断）的气机消耗（克制） */
  interruptCost: number;
}

export interface CombatConfig {
  slash: SlashConfig;
  speed: SpeedConfig;
  wolf: WolfConfig;
  player: PlayerConfig;
  damage: DamageConfig;
  ranged: RangedEnemyConfig;
  projectile: ProjectileConfig;
  /** 第九阶段：赤瞳山魈（第一章综合终局 Boss） */
  boss: import('./bossEncounter').BossConfig;
  /** 第九阶段收口：Boss 节奏门（机制布尔门/HP 地板/时长下限） */
  rhythm: import('./bossRhythmGate').BossRhythmConfig;
}


export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  slash: {
    minPathRatio: 0.1,
    minAvgSpeedRatio: 0.5,
    segmentWindowMs: 600,
    segmentIdleCloseMs: 250,
  },
  speed: {
    slowRatio: 0.9,
    goodRatio: 1.8,
    maxControllableRatio: 3.2,
  },
  wolf: {
    hpMax: 100,
    bodyRadiusRatio: 0.085,
    coreRadiusRatio: 0.42,
    spawnX: 1.15,
    dangerX: 0.62,
    approachSpeedRatio: 0.1,
    telegraphMs: 850,
    lungeDurationMs: 420,
    lungeTargetX: 0.24,
    lungeTargetY: 0.5,
    recoverSpeedRatio: 0.22,
    dyingMs: 650,
    lungeDamage: 30,
    blockBreakDamage: 22,
  },
  player: {
    qiMax: 100,
    guardQiMax: 100,
    // 第三阶段校准：0 到满气约 7.1s（100/14），只允许 SHEATHED 回气
    qiRegenPerSec: 14,
    qiExhaustedThreshold: 20,
    exhaustedDamageMul: 0.3,
    slashQiCostBase: 4,
    slashQiCostPerPathRatio: 12,
    slashQiCostMax: 11,
    outOfControlExtraQiCost: 10,
    blockQiCost: 15,
    blockChipDamage: 0,
  },
  damage: {
    base: 32,
    accuracyFactorMin: 0.6,
    accuracyFactorMax: 1.2,
    stabilityFactorMin: 0.7,
    stabilityFactorMax: 1.1,
  },
  ranged: {
    hpMax: 100,
    bodyRadiusRatio: 0.07,
    weakPointRadiusRatio: 0.34,
    weakPointAccuracyThreshold: 70,
    spawnX: 1.18,
    holdX: 0.88,
    enterSpeedRatio: 0.16,
    chargeMs: 1100,
    chargeWindupMs: 600,
    recoverMs: 900,
    interruptedMs: 1100,
    maxCycles: 3,
    dyingMs: 600,
    spawnDelayMs: 1400,
  },
  projectile: {
    radiusRatio: 0.028,
    speedRatio: 0.24,
    damage: 26,
    lifeMs: 6000,
    playerHitRadiusRatio: 0.1,
    blockable: false,
    slashCost: 3,
    interruptCost: 6,
  },
  boss: {
    // 第九阶段：赤瞳山魈 —— 约 60~90 秒的综合终局（不做磨血，全部可调）
    hpMax: 320,
    phase2HpPct: 0.66,
    phase3HpPct: 0.33,
    bodyRadiusRatio: 0.11,
    weakPointRadiusRatio: 0.34,
    spawnX: 1.2,
    dangerX: 0.6,
    approachSpeedRatio: 0.09,
    telegraphMs: 900,
    lungeDurationMs: 460,
    lungeTargetX: 0.24,
    lungeTargetY: 0.5,
    recoverSpeedRatio: 0.2,
    lungeDamage: 34,
    blockBreakDamage: 24,
    dyingMs: 800,
    rangeHoldX: 0.86,
    chargeMs: 1400,
    chargeWindupMs: 650,
    weakPointAccuracyThreshold: 68,
    interruptedMs: 1100,
    recoverMs: 900,
    chaosProjectileCap: 2,
    chaosLungeGapMs: 2600,
    projectileDamage: 30,
    unblockedBlastDamage: 38,
  },
  // 第九阶段收口：节奏门（防「9 秒速杀跳过整张考卷」；不做磨血）
  rhythm: DEFAULT_BOSS_RHYTHM_CONFIG,
};
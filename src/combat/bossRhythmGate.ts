/**
 * 第九阶段收口：Boss 节奏门（纯函数，无副作用）。
 *
 * 修复「快速身体攻击即可无机制胜利」：不大幅增加血量、不做磨血——
 * 用阶段机制布尔门 + HP 地板 + 时长下限三件套保证：
 * 1. 试剑阶段至少完整经历一次真实扑击窗口（预警→扑击→收势/格挡语义）才可进破势；
 * 2. 破势阶段至少完成一次蓄力并发射妖气弹（或被弱点打断）才可进乱战；
 * 3. 乱战阶段至少产生一次「有限妖气弹/扑击」组合才可判胜；
 * 4. 普通身体攻击不能直接取消蓄力（既有语义保持：只有弱点达标才 INTERRUPTED）；
 * 5. 整场至少 minEncounterMs，之前 Boss HP 有地板，不因爆发速攻跳过整张考卷。
 *
 * 所有判定输入均为 CombatEngine 已有真实状态字段，不新增第二套战斗循环。
 */

/** Boss 节奏门配置（combatConfig.boss.rhythm 段；全部可调） */
export interface BossRhythmConfig {
  /** 试剑阶段：至少完整扑击（到达玩家近旁被结算）次数 */
  minLungesPhase1: number;
  /** 破势阶段：至少完成的蓄力循环次数（发射或被破势均算） */
  minChargesPhase2: number;
  /** 乱战阶段：至少的机制组合数（妖气弹+扑击，任意一方先行） */
  minCombosPhase3: number;
  /** 机制门未满足时 Boss HP 下限（× hpMax）：速攻伤害在地板上被吸收 */
  hpFloorPctPhase1: number;
  hpFloorPctPhase2: number;
  hpFloorPctPhase3: number;
  /** 整场最短时长（ms）：低于此值 Boss 不死（HP 至少 1） */
  minEncounterMs: number;
}

export const DEFAULT_BOSS_RHYTHM_CONFIG: BossRhythmConfig = {
  minLungesPhase1: 1,
  minChargesPhase2: 1,
  minCombosPhase3: 1,
  hpFloorPctPhase1: 0.99,
  hpFloorPctPhase2: 0.65,
  hpFloorPctPhase3: 0.33,
  minEncounterMs: 20000,
};

/** 节奏门运行时统计（CombatEngine 每 encounter 重置；随真实事件递增） */
export interface BossRhythmState {
  /** 试剑阶段已完整结算的扑击次数（resolveBossLunge 成功到达） */
  lungesPhase1: number;
  /** 破势阶段已完成的蓄力循环（发射+被破势） */
  chargesPhase2: number;
  /** 乱战阶段机制组合计数（妖气弹发射与扑击到达各计一次，组合=minCombos*2 事件） */
  chaosEvents: number;
  /** 场上妖气弹计数（乱战组合的弹侧） */
  chaosProjectilesFired: number;
  chaosTechniqueHits: number;
}

export function emptyBossRhythmState(): BossRhythmState {
  return {
    lungesPhase1: 0,
    chargesPhase2: 0,
    chaosEvents: 0,
    chaosProjectilesFired: 0,
    chaosTechniqueHits: 0,
  };
}

/**
 * 判定是否允许从试剑进入破势（HP 阈值之外追加的节奏门）。
 * @param hp 当前 Boss HP
 * @param s 节奏门统计
 * @param cfg 节奏门配置
 * @param bossCfgPhase2HpPct combatConfig.boss.phase2HpPct（HP 阈值门仍由 bossPhaseForHp 主导）
 */
export function canEnterBreakStance(
  s: BossRhythmState,
  cfg: BossRhythmConfig,
): boolean {
  return s.lungesPhase1 >= cfg.minLungesPhase1;
}

/** 判定是否允许从破势进入乱战 */
export function canEnterChaos(s: BossRhythmState, cfg: BossRhythmConfig): boolean {
  return s.chargesPhase2 >= cfg.minChargesPhase2;
}

/** 判定是否允许在乱战阶段对 Boss 造成致命伤害（机制组合门） */
export function canDefeatInChaos(s: BossRhythmState, cfg: BossRhythmConfig): boolean {
  if (cfg.minCombosPhase3 <= 0) return true;
  return s.chaosEvents >= cfg.minCombosPhase3 * 2 && s.chaosProjectilesFired >= 1 && s.chaosTechniqueHits >= 1;
}

/**
 * HP 地板：机制门未满足时，Boss HP 不会低于该阶段地板。
 * 返回应用地板后的 hp（不修改输入）。
 */
export function applyHpFloor(
  hp: number,
  hpMax: number,
  phase: 1 | 2 | 3,
  s: BossRhythmState,
  cfg: BossRhythmConfig,
): number {
  if (phase === 1 && s.lungesPhase1 < cfg.minLungesPhase1) {
    return Math.max(hp, hpMax * cfg.hpFloorPctPhase1);
  }
  if (phase === 2 && s.chargesPhase2 < cfg.minChargesPhase2) {
    return Math.max(hp, hpMax * cfg.hpFloorPctPhase2);
  }
  if (phase === 3 && !canDefeatInChaos(s, cfg)) {
    return Math.max(hp, hpMax * cfg.hpFloorPctPhase3);
  }
  return hp;
}

/**
 * 时长下限：整场未达 minEncounterMs 时 Boss 至少保留 1 HP（不磨血——
 * 只挡「9 秒速杀」这种跳过整张考卷的极端；正常打满机制的战斗不会触地）。
 */
export function applyTimeFloor(hp: number, elapsedMs: number, cfg: BossRhythmConfig): number {
  if (elapsedMs < cfg.minEncounterMs && hp <= 0) return 1;
  return hp;
}

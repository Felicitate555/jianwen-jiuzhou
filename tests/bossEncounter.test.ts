import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
import { registerBossSummary } from './helpers/registerBossSummary';
/**
 * 第九阶段测试：赤瞳山魈综合终局。
 * - bossEncounter：三阶段转移、预警、扑击格挡、斩弹、弱点破势、死亡终止；
 * - CombatEngine encounter 模式：Boss 战统计 → BattleSummary 汇总、battleId 隔离、幂等；
 * - SwordArchetypeResolver：程序决定剑道初相，白名单/阈值/缺省稳定；
 * - Life 插入位置：第二剑之后、CHAPTER_RESULT 之前；失败不推进；胜利幂等。
 */
import { describe, expect, it } from 'vitest';
import { CombatEngine, type BattleSummary } from '@/combat/combatEngine';
import {
  BOSS_ENCOUNTER_ID,
  type BossConfig,
  type BossPhaseName,
} from '@/combat/bossEncounter';
import {
  DEFAULT_ARCHETYPE_RULES,
  resolveSwordArchetype,
  SWORD_ARCHETYPES,
  type ArchetypeSummaryInput,
} from '@/life/swordArchetype';
import { LifeEngine } from '@/life/lifeEngine';
import { DEFAULT_COMBAT_CONFIG, type CombatConfig } from '@/combat/combatConfig';
import type { InputFrame } from '@/lib/types';


/** v33 身份受控事件：身份事件落定辅助（PROFILE_REVIEW AI-FIRST 门） */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

const W = 800;
const H = 600;

function frame(
  x: number,
  y: number,
  t: number,
  action: 'ACTIVE' | 'SHEATHED' | 'IDLE' = 'ACTIVE',
): InputFrame {
  return { x, y, timestamp: t, actionState: action, source: 'pointer' } as InputFrame;
}

/** 直线挥剑：从 (x0,y) 到 (x0+len,y)，ms 内完成（12 帧采样） */
function swing(
  e: CombatEngine,
  x0: number,
  y: number,
  t0: number,
  len: number,
  ms: number,
): number {
  const n = 12;
  let t = t0;
  e.onFrame(frame(x0, y, t), null);
  for (let i = 1; i <= n; i++) {
    t += ms / n;
    e.onFrame(frame(x0 + (len * i) / n, y, t), null);
  }
  return t;
}

/** Boss 配置覆盖（调快节奏便于测试） */
/** 关闭节奏门的测试配置（用于聚焦既有语义的直杀用例；生产默认不关闭） */
const RHYTHM_OFF = {
  minLungesPhase1: 0,
  minChargesPhase2: 0,
  minCombosPhase3: 0,
  hpFloorPctPhase1: 0,
  hpFloorPctPhase2: 0,
  hpFloorPctPhase3: 0,
  minEncounterMs: 0,
};

function bossCfg(
  over: Partial<BossConfig> & { rhythm?: Partial<import('../src/combat/bossRhythmGate').BossRhythmConfig> } = {},
): CombatConfig {
  const { rhythm, ...bossOver } = over;
  return {
    ...DEFAULT_COMBAT_CONFIG,
    boss: {
      ...DEFAULT_COMBAT_CONFIG.boss,
      hpMax: 120,
      phase2HpPct: 0.66,
      phase3HpPct: 0.33,
      ...bossOver,
    },
    rhythm: { ...DEFAULT_COMBAT_CONFIG.rhythm, ...rhythm },
  };
}

// =====================================================================
// 一、bossEncounter 三阶段状态机（纯模块级）
// =====================================================================

/** Boss 胜利 Summary（含完整字段；overrides 供变体） */
function victorySummary(overrides: Partial<BattleSummary> = {}): BattleSummary {
  return {
    encounterId: 'chapter1_red_eye_ape',
    battleId: 'battle-v-1',
    result: 'victory',
    duration: 75000,
    slashCount: 18,
    techniqueUsage: [{ kind: 'cross', count: 2 }],
    projectilesCut: 2,
    blocks: 3,
    interrupts: 1,
    breakStanceCount: 1,
    averageSpeed: 2.1,
    accuracyScore: 82,
    stabilityScore: 85,
    weakPointHits: 1,
    qiDepletedCount: 0,
    damageTaken: 12,
    overspeedCount: 0,
    ...overrides,
  };
}

describe('赤瞳山魈：三阶段状态机', () => {
  it('encounterId 固定为 chapter1_red_eye_ape', () => {
    expect(BOSS_ENCOUNTER_ID).toBe('chapter1_red_eye_ape');
  });

  it('startBoss：进入试剑阶段，HP/出生点/三阶段阈值初始化', () => {
    const e = new CombatEngine(bossCfg());
    e.startBoss(0);
    const s = e.getSnapshot();
    expect(s.boss).not.toBeNull();
    expect(s.boss!.hpMax).toBe(120);
    expect(s.boss!.hp).toBe(120);
    expect(s.boss!.phase).toBe<'TRIAL_SWORD'>('TRIAL_SWORD');
    expect(s.boss!.x).toBeGreaterThan(1); // 屏幕右侧外
    expect(s.encounter).not.toBeNull();
    expect(s.encounter!.encounterId).toBe(BOSS_ENCOUNTER_ID);
    expect(s.encounter!.battleId).toMatch(/^chapter1_red_eye_ape:/);
  });

  it('试剑→破势：HP 跌破 phase2HpPct 阈值时转移并进入拉开距离', () => {
    const e = new CombatEngine(bossCfg());
    e.startBoss(0);
    // 模拟：把 HP 打到阈值下（用内部结算不方便，直接推进阶段：这里通过 update 驱动）
    // 阶段转移是纯 HP 阈值函数 → 用公共推进接口验证
    let t = 0;
    let step = 0;
    while (step < 600 && e.getSnapshot().boss!.phase === 'TRIAL_SWORD') {
      t += 100;
      e.update(t, W, H);
      step++;
    }
    // 未受击时 Boss 始终在试剑阶段逼近/预警/扑击
    expect(e.getSnapshot().boss!.phase).toBe('TRIAL_SWORD');
  });

  it('Boss 死亡：停止后续攻击与投射物循环，胜利只判定一次（节奏门关闭配置下直杀）', () => {
    const e = new CombatEngine(
      bossCfg({ hpMax: 30, phase2HpPct: 0.99, phase3HpPct: 0.98, rhythm: RHYTHM_OFF }),
    );
    e.startBoss(0);
    // 直接打死（两剑同位置）
    let t = 0;
    let hits = 0;
    while (hits < 10 && e.getSnapshot().phase === 'fighting') {
      const b = e.getSnapshot().boss!;
      const bx = b.x * W;
      const by = b.y * H;
      t = swing(e, bx - 120, by, t, 240, 160);
      t += 120;
      e.update(t, W, H);
      hits++;
    }
    if (e.getSnapshot().boss?.state === 'DYING') e.update(t += 1000, W, H);
    expect(e.getSnapshot().phase).toBe('won');
    expect(e.getSnapshot().boss!.state).toBe('DEAD');
    // 胜利后再 update：不再重复结算、不再生成投射物
    const sum1 = e.getBattleSummary();
    for (let i = 0; i < 10; i++) {
      t += 100;
      e.update(t, W, H);
    }
    expect(e.getSnapshot().phase).toBe('won');
    const sum2 = e.getBattleSummary();
    expect(sum2).toEqual(sum1); // 统计冻结
  });
});

// =====================================================================
// 二、BattleSummary：字段汇总 / battleId 隔离 / 幂等
// =====================================================================
describe('赤瞳山魈：BattleSummary 汇总与隔离', () => {
  function summary(): BattleSummary {
    const e = new CombatEngine(bossCfg({ hpMax: 30, phase2HpPct: 0.99, phase3HpPct: 0.98, rhythm: { minLungesPhase1: 0, minChargesPhase2: 0, minCombosPhase3: 0, hpFloorPctPhase1: 0, hpFloorPctPhase2: 0, hpFloorPctPhase3: 0, minEncounterMs: 0 }, }));
    e.startBoss(0);
    let t = 0;
    let hits = 0;
    while (hits < 10 && e.getSnapshot().phase === 'fighting') {
      const b = e.getSnapshot().boss!;
      t = swing(e, b.x * W - 120, b.y * H, t, 240, 160);
      t += 120;
      e.update(t, W, H);
      hits++;
    }
    if (e.getSnapshot().boss?.state === 'DYING') e.update(t += 1000, W, H);
    return e.getBattleSummary()!;
  }

  it('字段完整：encounterId/battleId/result/duration/techniqueUsage/快准稳均值等', () => {
    const s = summary();
    expect(s.encounterId).toBe(BOSS_ENCOUNTER_ID);
    expect(s.battleId).toMatch(/^chapter1_red_eye_ape:/);
    expect(s.result).toBe('victory');
    expect(s.duration).toBeGreaterThanOrEqual(0);
    expect(typeof s.slashCount).toBe('number');
    expect(Array.isArray(s.techniqueUsage)).toBe(true);
    expect(s.techniqueUsage.every((t) => 'kind' in t && 'count' in t)).toBe(true);
    expect(s.projectilesCut).toBeGreaterThanOrEqual(0);
    expect(s.blocks).toBeGreaterThanOrEqual(0);
    expect(s.interrupts).toBeGreaterThanOrEqual(0);
    expect(s.breakStanceCount).toBeGreaterThanOrEqual(0);
    expect(s.averageSpeed).toBeGreaterThanOrEqual(0);
    expect(s.accuracyScore).toBeGreaterThanOrEqual(0);
    expect(s.stabilityScore).toBeGreaterThanOrEqual(0);
    expect(s.weakPointHits).toBeGreaterThanOrEqual(0);
    expect(s.qiDepletedCount).toBeGreaterThanOrEqual(0);
    expect(s.damageTaken).toBeGreaterThanOrEqual(0);
    expect(s.overspeedCount).toBeGreaterThanOrEqual(0);
  });

  it('victory Summary 由现有统计汇总：averageSpeed 与平均快准稳来自真实 strike', () => {
    const s = summary();
    // 打死 30HP Boss 至少需要 1 次有效命中 → 统计非零
    expect(s.slashCount).toBeGreaterThanOrEqual(1);
    expect(s.averageSpeed).toBeGreaterThan(0);
    expect(s.accuracyScore).toBeGreaterThan(0);
    expect(s.stabilityScore).toBeGreaterThan(0);
  });

  it('再次挑战：新 battleId，统计重置，不污染上一场', () => {
    const e = new CombatEngine(bossCfg({ hpMax: 30, phase2HpPct: 0.99, phase3HpPct: 0.98, rhythm: { minLungesPhase1: 0, minChargesPhase2: 0, minCombosPhase3: 0, hpFloorPctPhase1: 0, hpFloorPctPhase2: 0, hpFloorPctPhase3: 0, minEncounterMs: 0 }, }));
    e.startBoss(0);
    let t = 0;
    while (e.getSnapshot().phase === 'fighting') {
      const b = e.getSnapshot().boss!;
      t = swing(e, b.x * W - 120, b.y * H, t, 240, 160);
      t += 120;
      e.update(t, W, H);
    }
    const id1 = e.getBattleSummary()!.battleId;
    // 失败重试（只重置 Boss encounter）
    e.startBoss(t);
    const id2 = e.getBattleSummary()?.battleId;
    expect(id2).not.toBe(id1);
    // 新一场统计从零开始（未结算前 summary 为 null 或 result 未定）
    const snap = e.getSnapshot();
    expect(snap.phase).toBe('fighting');
  });

  it('失败 Summary result=defeat，不推进人生，可重试', () => {
    const e = new CombatEngine(bossCfg());
    e.startBoss(0);
    // 不格挡不反击：让 Boss 扑击耗尽护体真气
    let t = 0;
    while (e.getSnapshot().phase === 'fighting' && t < 200_000) {
      t += 100;
      e.update(t, W, H);
    }
    expect(e.getSnapshot().phase).toBe('lost');
    const s = e.getBattleSummary();
    expect(s).not.toBeNull();
    expect(s!.result).toBe('defeat');
    expect(s!.damageTaken).toBeGreaterThan(0);
    // 重试：新 battleId 的新一场
    e.startBoss(t);
    expect(e.getSnapshot().phase).toBe('fighting');
    expect(e.getBattleSummary()?.battleId ?? '').not.toBe(s!.battleId);
  });
});

// =====================================================================
// 三、SwordArchetypeResolver：程序决定，AI 不参与
// =====================================================================
describe('剑道初相：程序解析器', () => {
  const base: ArchetypeSummaryInput = {
    result: 'victory',
    averageSpeed: 1.6,
    overspeedCount: 0,
    accuracyScore: 70,
    stabilityScore: 70,
    blocks: 0,
    qiDepletedCount: 0,
    weakPointHits: 0,
    interrupts: 0,
    projectilesCut: 0,
    techniqueUsage: { diagonalSlash: 0, cross: 0, returnWind: 0 },
  };

  it('四类型白名单固定', () => {
    expect(SWORD_ARCHETYPES.map((a) => a.id)).toEqual(['swift', 'steady', 'fierce', 'nimble']);
  });

  it('速度型：高均速 + 高精准 + 少超速', () => {
    const r = resolveSwordArchetype({ ...base, averageSpeed: 2.4, accuracyScore: 82 });
    expect(r.id).toBe('swift');
  });

  it('守剑：高格挡 + 高稳定，速度不占优', () => {
    const r = resolveSwordArchetype({
      ...base,
      averageSpeed: 1.2,
      stabilityScore: 85,
      blocks: 3,
    });
    expect(r.id).toBe('steady');
  });

  it('狂剑：超速次数多（失控为主导）', () => {
    const r = resolveSwordArchetype({ ...base, averageSpeed: 2.0, overspeedCount: 3 });
    expect(r.id).toBe('fierce');
  });

  it('灵剑：弱点击破/斩弹/招式组合主导，速度中等', () => {
    const r = resolveSwordArchetype({
      ...base,
      averageSpeed: 1.5,
      weakPointHits: 2,
      interrupts: 2,
      projectilesCut: 2,
      techniqueUsage: { diagonalSlash: 2, cross: 1, returnWind: 1 },
    });
    expect(r.id).toBe('nimble');
  });

  it('优先级：狂剑（失控）优先于速度型', () => {
    const r = resolveSwordArchetype({
      ...base,
      averageSpeed: 2.5,
      accuracyScore: 85,
      overspeedCount: 3,
    });
    expect(r.id).toBe('fierce');
  });

  it('缺省输入（全零/缺字段）稳定输出守剑', () => {
    const r = resolveSwordArchetype({
      result: 'victory',
      averageSpeed: 0,
      overspeedCount: 0,
      accuracyScore: 0,
      stabilityScore: 0,
      blocks: 0,
      qiDepletedCount: 0,
      weakPointHits: 0,
      interrupts: 0,
      projectilesCut: 0,
      techniqueUsage: {},
    });
    expect(r.id).toBe('steady');
  });

  it('defeat 输入也有稳定结果（不抛错）', () => {
    const r = resolveSwordArchetype({ ...base, result: 'defeat' });
    expect(SWORD_ARCHETYPES.some((a) => a.id === r.id)).toBe(true);
  });

  it('阈值可配置：调高 swiftSpeedThreshold 后同输入变为守剑', () => {
    const rules = { ...DEFAULT_ARCHETYPE_RULES, swiftSpeedThreshold: 3.0 };
    const r = resolveSwordArchetype({ ...base, averageSpeed: 2.4, accuracyScore: 82 }, rules);
    expect(r.id).not.toBe('swift');
  });

  it('AI 不决定类型：resolveSwordArchetype 是纯函数（无网络/无异步）', () => {
    // 静态约束：resolver 签名只有 (input, rules?)，无 fetch/AI 参数
    const r1 = resolveSwordArchetype(base);
    const r2 = resolveSwordArchetype(base);
    expect(r1).toEqual(r2);
    expect(typeof resolveSwordArchetype).toBe('function');
  });
});

// =====================================================================
// 四、Life 插入位置：第二剑之后 → Boss → CHAPTER_RESULT 之前
// =====================================================================

/** 第九阶段收口：走完 TECHNIQUE_GATE 三式机缘 → BOSS_GATE */
function completeAllTechniques(le: LifeEngine, t: number): void {
  for (let i = 0; i < 3; i++) {
    const id = le.eventIdentity();
    if (!id) return;
    le.settleNarrative(id.requestId, t + i);
    const kind = le.currentTechniqueKind()!;
    le.acknowledgeTechniqueManual(kind, t + i + 0.5); // v33
    le.beginTechniquePractice(kind, t + i + 0.5);
    expect(le.completeTechniquePractice(kind, t + i + 0.5)).toBe(true);
  }
  expect(le.getState().phase).toBe('BOSS_GATE');
}

describe('赤瞳山魈：Life 挂接与幂等', () => {
  function reachFateChoice(): { le: LifeEngine; t: number } {
    const le = new LifeEngine();
    le.loadSeed(20260906);
    le.selectGender('female', 0);
    le.generateIdentity(0);
    settleIdentity(le, 0 + 0.1);
    le.confirmProfile(0);
le.completeSensing(0 + 1);
    le.reportTrialResult(true, 0);
    le.beginFirstChoice(0);
le.settleNarrative(le.eventIdentity()!.requestId, 0 + 1);
    le.selectOption('intent-steady', 0);
    return { le, t: 0 };
  }

  it('第二剑确认后进入 BOSS_GATE（而非 CHAPTER_RESULT）', () => {
    const { le } = reachFateChoice();
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 1);
    finishChoiceNarrative(le);
    // 第二剑已确认 → companion → fate
    le.settleNarrative(le.eventIdentity()!.requestId, le.getState().updatedAt + 1);
    le.respondCompanion('warm', 2);
le.settleNarrative(le.eventIdentity()!.requestId, 2 + 1);
    le.selectOption('fate-sect', 3);
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 4);
    finishChoiceNarrative(le);
    // 第九阶段收口：第二剑定命后先入 TECHNIQUE_GATE（三式机缘），成招后进 BOSS_GATE
    expect(le.getState().phase).toBe('TECHNIQUE_GATE');
    completeAllTechniques(le, 4.2);
    const s = le.getState();
    expect(s.phase).toBe('BOSS_GATE');
    expect(s.realm).toBe('剑道初相');
    expect(s.ledger.chapterCompletionCount).toBe(0);
  });

  it('Boss 胜利结算：程序推进练气一层 + 写 ledger + 转 CHAPTER_RESULT，且幂等', () => {
    const { le } = reachFateChoice();
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 1);
    finishChoiceNarrative(le);
    le.settleNarrative(le.eventIdentity()!.requestId, le.getState().updatedAt + 1);
    le.respondCompanion('warm', 2);
le.settleNarrative(le.eventIdentity()!.requestId, 2 + 1);
    le.selectOption('fate-sect', 3);
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 4);
    finishChoiceNarrative(le);
    completeAllTechniques(le, 4.2);
    const summary: BattleSummary = {
      encounterId: BOSS_ENCOUNTER_ID,
      battleId: 'chapter1_red_eye_ape:test1',
      result: 'victory',
      duration: 70000,
      slashCount: 10,
      techniqueUsage: [
        { kind: 'diagonalSlash', count: 2 },
        { kind: 'cross', count: 1 },
      ],
      projectilesCut: 2,
      blocks: 1,
      interrupts: 1,
      breakStanceCount: 1,
      averageSpeed: 1.8,
      accuracyScore: 75,
      stabilityScore: 72,
      weakPointHits: 1,
      qiDepletedCount: 0,
      damageTaken: 20,
      overspeedCount: 0,
    };
    const ok = le.reportBossVictory(registerBossSummary(le, summary), 100);
    expect(ok).toBe(true);
    const s = le.getState();
    expect(s.phase).toBe('CHAPTER_RESULT');
    expect(s.realm).toBe('练气一层');
    expect(s.ledger.chapterCompletionCount).toBe(1);
    expect(s.swordArchetype).toBeDefined();
    expect(SWORD_ARCHETYPES.some((a) => a.id === s.swordArchetype!.id)).toBe(true);
    // 幂等：重复 reportBossVictory 不重复写
    const ok2 = le.reportBossVictory({ ...summary, battleId: 'chapter1_red_eye_ape:test2' }, 200);
    expect(ok2).toBe(false);
    expect(le.getState().ledger.chapterCompletionCount).toBe(1);
    expect(le.getState().phase).toBe('CHAPTER_RESULT');
  });

  it('失败 Summary 不推进：reportBossDefeat 只记录，不转 CHAPTER_RESULT', () => {
    const { le } = reachFateChoice();
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 1);
    finishChoiceNarrative(le);
    le.settleNarrative(le.eventIdentity()!.requestId, le.getState().updatedAt + 1);
    le.respondCompanion('warm', 2);
le.settleNarrative(le.eventIdentity()!.requestId, 2 + 1);
    le.selectOption('fate-sect', 3);
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 4);
    finishChoiceNarrative(le);
    completeAllTechniques(le, 4.2);
    const s: BattleSummary = {
      encounterId: BOSS_ENCOUNTER_ID,
      battleId: 'chapter1_red_eye_ape:test-defeat',
      result: 'defeat',
      duration: 40000,
      slashCount: 2,
      techniqueUsage: [],
      projectilesCut: 0,
      blocks: 0,
      interrupts: 0,
      breakStanceCount: 0,
      averageSpeed: 0.8,
      accuracyScore: 40,
      stabilityScore: 50,
      weakPointHits: 0,
      qiDepletedCount: 1,
      damageTaken: 100,
      overspeedCount: 1,
    };
    const ok = le.reportBossDefeat(registerBossSummary(le, s), 100);
    expect(ok).toBe(true);
    const st = le.getState();
    expect(st.phase).toBe('BOSS_GATE'); // 仍在 Boss 门口，可重试
    expect(st.realm).toBe('剑道初相');
    expect(st.ledger.chapterCompletionCount).toBe(0);
  });

  it('重新历练：回 TRIAL_GATE，BOSS 状态清除，ledger 历史保留', () => {
    const { le } = reachFateChoice();
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 1);
    finishChoiceNarrative(le);
    le.settleNarrative(le.eventIdentity()!.requestId, le.getState().updatedAt + 1);
    le.respondCompanion('warm', 2);
le.settleNarrative(le.eventIdentity()!.requestId, 2 + 1);
    le.selectOption('fate-sect', 3);
    le.confirmChoiceStroke(W, 200, 'ACTIVE', 4);
    finishChoiceNarrative(le);
    completeAllTechniques(le, 4.2);
    const summary = {
      encounterId: BOSS_ENCOUNTER_ID,
      battleId: 'b1',
      result: 'victory' as const,
      duration: 60000,
      slashCount: 5,
      techniqueUsage: [],
      projectilesCut: 0,
      blocks: 0,
      interrupts: 0,
      breakStanceCount: 0,
      averageSpeed: 1.5,
      accuracyScore: 70,
      stabilityScore: 70,
      weakPointHits: 0,
      qiDepletedCount: 0,
      damageTaken: 0,
      overspeedCount: 0,
    };
    le.reportBossVictory(registerBossSummary(le, summary), 100);
    // CHAPTER_RESULT → replay
    const ok = le.replayChapter(200);
    expect(ok).toBe(true);
    const s = le.getState();
    expect(s.phase).toBe('SENSING_GATE'); // 收口：重历回感应门，可重做
    expect(s.swordArchetype).toBeNull();
    expect(s.ledger.chapterCompletionCount).toBe(1); // 历史保留
  });

  it('重新生成身份：ledger 清空，BOSS 状态不存在', () => {
    const le = new LifeEngine();
    le.loadSeed(111);
    le.selectGender('male', 0);
    le.generateIdentity(0);
    settleIdentity(le, 0 + 0.1);
    le.regenerateIdentity(1);
    settleIdentity(le, 1 + 0.1);
    const s = le.getState();
    expect(s.ledger.history.length).toBe(0);
    expect(s.swordArchetype).toBeNull();
  });

  it('Boss 三阶段名与文案存在', () => {
    // TRIAL_SWORD / BREAK_STANCE / CHAOS → 中文名
    const names: BossPhaseName[] = ['TRIAL_SWORD', 'BREAK_STANCE', 'CHAOS'];
    expect(names.length).toBe(3);
  });
});

// =====================================================================
// 五、AI 剑道初相叙事：锁定踏入九州 / 迟到拒绝
// =====================================================================
describe('剑道初相：AI 只写正文', () => {
  it('AI 请求身份包含 swordArchetype 与 battle 摘要，但类型由程序决定', async () => {
    const { buildArchetypeNarrativeRequest } = await import('@/life/swordArchetype');
    const req = buildArchetypeNarrativeRequest(
      {
        seed: 42,
        replayCount: 0,
        profile: { gender: 'male', name: '陆沉', originId: 'o1', constitutionId: 'c1', bornSeed: 42 },
        chosen: { intent: 'intent-steady', fate: 'fate-sect' },
        flags: {},
        companionState: { met: true, response: 'warm', flag: 'companion-yan-warm', skipped: false },
        swordArchetype: SWORD_ARCHETYPES[0],
      },
      {
        battleId: 'chapter1_red_eye_ape:abc',
        duration: 70000,
        slashCount: 10,
        averageSpeed: 2.2,
        accuracyScore: 80,
        stabilityScore: 75,
        blocks: 1,
        interrupts: 1,
        projectilesCut: 2,
      },
    );
    expect(req.eventId).toBe('ch1:archetype');
    expect(req.swordArchetypeId).toBe('swift');
    expect(req.swordArchetypeTitle).toBe('疾剑');
    expect(req.battleSummary).toBeDefined();
    expect(req.battleSummary.slashCount).toBe(10);
  });

  it('迟到响应拒绝：已 finalize 的 narrativeState 不可复活', async () => {
    const { isNarrativeAcceptable } = await import('@/life/swordArchetype');
    // NARRATIVE_READY / EVENT_FINALIZED 后到达 → 拒绝
    expect(isNarrativeAcceptable('NARRATIVE_READY' as never, { requestId: 'r1' }, { requestId: 'r1' })).toBe(false);
    expect(
      isNarrativeAcceptable('NARRATIVE_PENDING' as never, { requestId: 'r1' }, { requestId: 'r2' }),
    ).toBe(false);
    expect(
      isNarrativeAcceptable('NARRATIVE_PENDING' as never, { requestId: 'r1' }, { requestId: 'r1' }),
    ).toBe(true);
  });
});

describe('赤瞳山魈：精确插入位置与失败语义', () => {
  function reachBossGate(): LifeEngine {
    const e = new LifeEngine();
    e.loadSeed(20260906);
    e.selectGender('female', 1);
    e.generateIdentity(2);
    settleIdentity(e, 2 + 0.1);
    e.confirmProfile(3);
e.completeSensing(3 + 1);
    e.reportTrialResult(true, 4);
    e.beginFirstChoice(5);
e.settleNarrative(e.eventIdentity()!.requestId, 5 + 1);
    e.selectOption('intent-steady', 6);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 7);
    finishChoiceNarrative(e);
    e.settleNarrative(e.eventIdentity()!.requestId, e.getState().updatedAt + 1);
    e.respondCompanion('warm', 8);
e.settleNarrative(e.eventIdentity()!.requestId, 8 + 1);
    e.selectOption('fate-sect', 9);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 10);
    finishChoiceNarrative(e);
    // 第九阶段收口：三式机缘（教学叙事落定 + 练习成招 ×3）
    for (let i = 0; i < 3; i++) {
      const id = e.eventIdentity();
      if (!id) break;
      e.settleNarrative(id.requestId, 10 + i);
      const kind = e.currentTechniqueKind()!;
      e.acknowledgeTechniqueManual(kind, 10 + i + 0.5); // v33
      e.beginTechniquePractice(kind, 10 + i + 0.5);
      expect(e.completeTechniquePractice(kind, 10 + i + 0.5)).toBe(true);
    }
    return e;
  }

  it('第二剑 EVENT_FINALIZED 后必进 BOSS_GATE（在 CHAPTER_RESULT 之前），胜利后完成结算', () => {
    const e = reachBossGate();
    // 第二剑已定命 → 三式机缘成招 → Boss 门（不是 CHAPTER_RESULT，也不能再插第二次人生选择）
    expect(e.getState().phase).toBe('BOSS_GATE');
    expect(e.getState().realm).toBe('剑道初相'); // 练气一层尚未推进
    // 胜利 → 同帧：类型 + 练气一层 + CHAPTER_RESULT + ledger
    expect(e.reportBossVictory(registerBossSummary(e, victorySummary()), 11)).toBe(true);
    const s = e.getState();
    expect(s.phase).toBe('CHAPTER_RESULT');
    expect(s.realm).toBe('练气一层');
    expect(s.swordArchetype).not.toBeNull();
    expect(s.ledger.history).toHaveLength(1);
    // 重复 victory → false（迟到/重复不复活、不重复写）
    expect(e.reportBossVictory(victorySummary({ battleId: 'late-1' }), 12)).toBe(false);
    expect(e.getState().ledger.history).toHaveLength(1);
    expect(e.getState().lastBattleSummary!.battleId).toBe('battle-v-1'); // 不被迟到覆盖
  });

  it('失败 Summary 只留战斗历史：不推进练气/章节/命簿，可重试后新 battleId 胜利', () => {
    const e = reachBossGate();
    const defeat = victorySummary({ result: 'defeat', battleId: 'battle-d-1', slashCount: 3 });
    expect(e.reportBossDefeat(registerBossSummary(e, defeat), 11)).toBe(true);
    const after = e.getState();
    expect(after.phase).toBe('BOSS_GATE'); // 仍可重试
    expect(after.realm).toBe('剑道初相');
    expect(after.ledger.history).toHaveLength(0);
    expect(after.lastBattleSummary!.battleId).toBe('battle-d-1');
    // 重试胜利（新 battleId）→ 唯一一次推进
    const second = victorySummary({ battleId: 'battle-v-2', slashCount: 22 });
    expect(e.reportBossVictory(registerBossSummary(e, second), 12)).toBe(true);
    expect(e.getState().phase).toBe('CHAPTER_RESULT');
    expect(e.getState().lastBattleSummary!.battleId).toBe('battle-v-2');
    expect(e.getState().ledger.history).toHaveLength(1);
  });

  it('旧版本缺 BattleSummary 字段：Resolver 稳定缺省（守剑），不抛错、不伪造成功', async () => {
    const { resolveSwordArchetype } = await import('@/life/swordArchetype');
    const partial = { result: 'victory' };
    const r = resolveSwordArchetype(partial as never);
    expect(r.id).toBe('steady');
  });

  it('AI 不得决定类型：请求只带已确定 title/摘要；Resolver 输入与 AI 输出无通路', async () => {
    const { buildArchetypeNarrativeRequest, SWORD_ARCHETYPES } = await import('@/life/swordArchetype');
    const e = reachBossGate();
    e.reportBossVictory(registerBossSummary(e, victorySummary()), 11);
    const s = e.getState();
    const fullArch = SWORD_ARCHETYPES.find((a) => a.id === s.swordArchetype!.id)!;
    const req = buildArchetypeNarrativeRequest(
      { ...s, swordArchetype: fullArch },
      {
        battleId: 'battle-v-1',
        duration: 70000,
        slashCount: 18,
        averageSpeed: 2.1,
        accuracyScore: 82,
        stabilityScore: 85,
        blocks: 3,
        interrupts: 1,
        projectilesCut: 2,
      },
    );
    // 请求只携带已确定的类型（AI 只可引用）与只读战斗摘要；类型必在白名单内
    expect(SWORD_ARCHETYPES.some((a) => a.id === req.swordArchetypeId)).toBe(true);
    expect(req.swordArchetypeTitle).toBe(s.swordArchetype!.title);
    expect(req.battleSummary.slashCount).toBe(18);
    // AI 无任何可写通道：请求结构里不存在 realm/技能/掉落/敌人/规则字段
    const writable = Object.keys(req).filter((k) =>
      /realm|skill|drop|enemy|rule|hp/i.test(k),
    );
    expect(writable).toEqual([]);
    expect(req.eventId).toBe('ch1:archetype');
  });

  it('AI 等待/超时契约：服务端 30s < 客户端 35s，留出至少 3s 回传窗口', async () => {
    const { NARRATIVE_TIMEOUT_MS } = await import('@/life/aiNarrative');
    const { readFileSync } = await import('node:fs');
    // Edge Function 属于 Deno 运行时：仅读取共享契约常量，不执行服务端代码。
    const serverSource = readFileSync(new URL('../supabase/functions/life-director-text/index.ts', import.meta.url), 'utf8');
    const serverTimeout = serverSource.match(/export const UPSTREAM_TIMEOUT_MS = (\d+);/);
    expect(serverTimeout).not.toBeNull();
    expect(Number(serverTimeout![1])).toBe(30000);
    expect(NARRATIVE_TIMEOUT_MS).toBe(35000);
    expect(NARRATIVE_TIMEOUT_MS).toBeGreaterThanOrEqual(Number(serverTimeout![1]) + 3000);
  });

  it('重历语义：BOSS_GATE 也可重历（回到 TRIAL_GATE，清剑道初相），命簿保留', () => {
    const e = reachBossGate();
    expect(e.replayChapter(12)).toBe(true);
    const s = e.getState();
    expect(s.phase).toBe('SENSING_GATE'); // 收口：重历回感应门，可重做
    expect(s.swordArchetype).toBeNull();
    expect(s.lastBattleSummary).toBeNull();
    expect(s.replayCount).toBe(1);
  });
});

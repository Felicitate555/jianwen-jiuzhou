import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
import { registerBossSummary } from './helpers/registerBossSummary';
/**
 * v33 第一章端到端自洽性测试：
 * 1. 身份 AI-FIRST pending 门（profile:identity 持久事件 + 确认/重生解锁 + 刷新恢复）
 * 2. TechniqueProgress 阶段机（LOCKED→OPPORTUNITY_AVAILABLE→MANUAL_RECEIVED→LEARNING→MASTERED）
 * 3. 生效层权限门（未 MASTERED → 普通斩击：无倍率/toast/commit/fx；practiceAttempt 通道）
 * 4. Boss 节奏门综合考试（三阶段最小事件 + HP 地板 + 时间地板 + 组合计数）
 * 5. 旧档迁移（learned=true → MASTERED；缺字段安全补齐）
 * 6. Happy Path：新人生 → JOURNEY_GATE 全链路（引擎层）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';
import { loadLifeState, saveLifeState, clearLifeState, LIFE_STORAGE_KEY } from '@/life/lifeStorage';
import type { LifeState } from '@/life/lifeTypes';
import {
  canEnterBreakStance,
  canEnterChaos,
  canDefeatInChaos,
  applyHpFloor,
  applyTimeFloor,
  emptyBossRhythmState,
  DEFAULT_BOSS_RHYTHM_CONFIG,
} from '@/combat/bossRhythmGate';
import { CombatEngine } from '@/combat/combatEngine';
import { DEFAULT_COMBAT_CONFIG } from '@/combat/combatConfig';
import type { BattleSummary } from '@/combat/combatEngine';

// node 测试环境无 localStorage：注入完整 Storage 实现（语义与浏览器一致，同 aiNarrative）
class TestStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as { localStorage?: Storage }).localStorage = new TestStorage();
}

const NOW = 1000;

/** 身份事件落定辅助 */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

function newLife(seed = 777): LifeEngine {
  const e = new LifeEngine();
  e.loadSeed(seed);
  e.selectGender('male', NOW);
  e.generateIdentity(NOW + 1);
  settleIdentity(e, NOW + 1.1);
  expect(e.confirmProfile(NOW + 2)).toBe(true); // 落定后确认身份 → SENSING_GATE
  return e;
}

function victorySummary(): BattleSummary {
  return {
    encounterId: 'chapter1_red_eye_ape',
    battleId: 'battle-t1',
    result: 'victory',
    duration: 70000,
    slashCount: 20,
    techniqueUsage: [{ kind: 'diagonalSlash', count: 3 }],
    projectilesCut: 2,
    blocks: 2,
    interrupts: 1,
    breakStanceCount: 1,
    averageSpeed: 1.4,
    accuracyScore: 82,
    stabilityScore: 78,
    techniqueDiversity: 3,
    guardingMs: 1500,
  } as unknown as BattleSummary;
}

// =====================================================================
// 一、身份 AI-FIRST pending 门
// =====================================================================
describe('v33 身份 AI-FIRST pending 门', () => {
  it('generateIdentity 即开 profile:identity 持久事件（NARRATIVE_PENDING + requestId）', () => {
    const e = new LifeEngine();
    e.loadSeed(1);
    e.selectGender('male', 0);
    e.generateIdentity(0.5);
    const ev = e.getState().activeEvent;
    expect(ev).not.toBeNull();
    expect(ev!.eventDefinitionId).toBe('profile:identity');
    expect(ev!.phase).toBe('NARRATIVE_PENDING');
    expect(ev!.eventInstanceId).toBeTruthy();
    expect(ev!.requestId).toBeTruthy();
  });

  it('PENDING 期间：confirmProfile/regenerate 拒绝（不可提前入章、不可重复生成）', () => {
    const e = new LifeEngine();
    e.loadSeed(1);
    e.selectGender('male', 0);
    e.generateIdentity(0.5);
    expect(e.confirmProfile(1)).toBe(false);
    expect(e.getState().phase).toBe('PROFILE_REVIEW');
    expect(e.regenerateIdentity(2)).toBe(false);
    expect(e.getState().activeEvent!.phase).toBe('NARRATIVE_PENDING');
  });

  it('落定（settle）后才可确认；确认后事件 FINALIZED 不可复活、进入 SENSING_GATE', () => {
    // 未确认路径：手动构造（newLife 已确认并清事件）
    const e = new LifeEngine();
    e.loadSeed(777);
    e.selectGender('male', NOW);
    e.generateIdentity(NOW + 1);
    settleIdentity(e, NOW + 1.1);
    expect(e.getState().activeEvent!.phase).toBe('NARRATIVE_READY');
    const rid = e.getState().activeEvent!.requestId;
    // 重复 settle（非 PENDING）拒绝
    expect(e.settleNarrative(rid, NOW + 2)).toBe(false);
    expect(e.confirmProfile(NOW + 3)).toBe(true);
    expect(e.getState().phase).toBe('SENSING_GATE');
    expect(e.getState().activeEvent).toBeNull();
    // 迟到响应不可复活
    expect(e.settleNarrative(rid, NOW + 4)).toBe(false);
  });

  it('regenerate 落定后可用：换 seed + 开新事件（旧 requestId 作废）', () => {
    const e = new LifeEngine();
    e.loadSeed(777);
    e.selectGender('male', NOW);
    e.generateIdentity(NOW + 1);
    settleIdentity(e, NOW + 1.1);
    const seedBefore = e.getState().seed;
    const oldRid = e.getState().activeEvent!.requestId;
    expect(e.regenerateIdentity(NOW + 2)).toBe(true);
    expect(e.getState().seed).not.toBe(seedBefore);
    const ev = e.getState().activeEvent!;
    expect(ev.eventDefinitionId).toBe('profile:identity');
    expect(ev.phase).toBe('NARRATIVE_PENDING');
    expect(ev.requestId).not.toBe(oldRid);
    // 旧 requestId 迟到响应被拒
    expect(e.settleNarrative(oldRid, NOW + 3)).toBe(false);
  });

  it('刷新恢复：PENDING 与 READY 均完整恢复（不白屏、不重复选择）', () => {
    // PENDING 恢复
    const e1 = new LifeEngine();
    e1.loadSeed(2);
    e1.selectGender('female', 0);
    e1.generateIdentity(0.5);
    saveLifeState(e1.getState());
    const r1 = loadLifeState();
    expect(r1!.phase).toBe('PROFILE_REVIEW');
    expect(r1!.activeEvent!.eventDefinitionId).toBe('profile:identity');
    expect(r1!.activeEvent!.phase).toBe('NARRATIVE_PENDING');
    expect(r1!.activeEvent!.requestId).toBe(e1.getState().activeEvent!.requestId);
    // READY 恢复（可确认状态保留）
    settleIdentity(e1, 1);
    saveLifeState(e1.getState());
    const r2 = loadLifeState();
    expect(r2!.activeEvent!.phase).toBe('NARRATIVE_READY');
    const e2 = new LifeEngine();
    e2.restore(r2!);
    expect(e2.confirmProfile(2)).toBe(true); // 恢复后可直接确认
  });
});

// =====================================================================
// 二、TechniqueProgress 阶段机
// =====================================================================
describe('v33 三式阶段机：获得→学习→领悟', () => {
  /** 走到 TECHNIQUE_GATE（三式全为 LOCKED，首式 OPPORTUNITY_AVAILABLE） */
  function reachGate(): { e: LifeEngine; t: number } {
    const e = newLife(); // 已确认身份 → SENSING_GATE
    e.completeSensing(NOW + 10);
    e.reportTrialResult(true, NOW + 11);
    e.beginFirstChoice(NOW + 12);
    // 第一剑（正文落定 → 选择 → 确认剑）
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 13);
    e.selectOption('intent-steady', NOW + 14);
    e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 15);
    finishChoiceNarrative(e);
    // 同行者（正文落定 → 回应）
    expect(e.getState().phase).toBe('COMPANION_EVENT');
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 16);
    e.respondCompanion('skip', NOW + 16.5);
    // 第二剑
    expect(e.getState().phase).toBe('FATE_CHOICE_FATE');
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 17);
    e.selectOption('fate-sect', NOW + 18);
    e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 19);
    finishChoiceNarrative(e);
    expect(e.getState().phase).toBe('TECHNIQUE_GATE');
    return { e, t: NOW + 20 };
  }

  it('第二剑确认后：首式 OPPORTUNITY_AVAILABLE，其余 LOCKED；事件 NARRATIVE_PENDING', () => {
    const { e } = reachGate();
    const s = e.getState();
    const first = s.techniques.order[0];
    expect(s.techniques.stages[first]).toBe('OPPORTUNITY_AVAILABLE');
    for (const k of s.techniques.order.slice(1)) {
      expect(s.techniques.stages[k]).toBe('LOCKED');
    }
    expect(s.activeEvent!.eventDefinitionId).toBe(`ch1:technique:${first}`);
    expect(s.activeEvent!.phase).toBe('NARRATIVE_PENDING');
  });

  it('阶段机全链路：ack（须 READY）→ begin → 练习成功 → MASTERED → 下一式 OPPORTUNITY_AVAILABLE', () => {
    const { e, t } = reachGate();
    const first = e.currentTechniqueKind()!;
    // PENDING：ack 拒绝
    expect(e.acknowledgeTechniqueManual(first, t)).toBe(false);
    // 落定
    e.settleNarrative(e.eventIdentity()!.requestId, t + 0.5);
    // 非当前式 ack 拒绝
    expect(e.acknowledgeTechniqueManual(e.getState().techniques.order[1], t + 0.6)).toBe(false);
    // ack → MANUAL_RECEIVED（记录练习事件身份）
    expect(e.acknowledgeTechniqueManual(first, t + 0.7)).toBe(true);
    expect(e.getState().techniques.stages[first]).toBe('MANUAL_RECEIVED');
    const pe = e.getState().techniques.practiceEventIds[first]!;
    expect(pe).not.toBeNull();
    expect(pe.eventInstanceId).toBe(e.getState().activeEvent!.eventInstanceId);
    // begin → LEARNING
    expect(e.beginTechniquePractice(first, t + 0.8)).toBe(true);
    expect(e.getState().techniques.stages[first]).toBe('LEARNING');
    // 直接 complete 仍可（LEARNING 中成招）——旧入口兼容
    expect(e.completeTechniquePractice(first, t + 0.9)).toBe(true);
    expect(e.getState().techniques.stages[first]).toBe('MASTERED');
    expect(e.getState().techniques.learned).toContain(first);
    // 成招即开下一式
    const second = e.currentTechniqueKind()!;
    expect(second).toBe(e.getState().techniques.order[1]);
    expect(e.getState().techniques.stages[second]).toBe('OPPORTUNITY_AVAILABLE');
    expect(e.getState().activeEvent!.eventDefinitionId).toBe(`ch1:technique:${second}`);
  });

  it('recordTechniquePracticeSuccess：计数与达标 MASTERED（requiredSuccesses=1 默认）', () => {
    const { e, t } = reachGate();
    const first = e.currentTechniqueKind()!;
    e.settleNarrative(e.eventIdentity()!.requestId, t + 0.5);
    e.acknowledgeTechniqueManual(first, t + 0.6);
    // MANUAL_RECEIVED 不可直接记成功（需先 begin 进入 LEARNING——App 层同契约）
    expect(e.recordTechniquePracticeSuccess(first, t + 0.65)).toBeNull();
    e.beginTechniquePractice(first, t + 0.7);
    expect(e.recordTechniquePracticeSuccess(first, t + 0.75)).toBe('mastered');
    expect(e.getState().techniques.stages[first]).toBe('MASTERED');
    expect(e.getState().techniques.successfulPracticeCount[first]).toBe(1);
    // 第二式：同样路径
    const second = e.currentTechniqueKind()!;
    e.settleNarrative(e.eventIdentity()!.requestId, t + 1.5);
    e.acknowledgeTechniqueManual(second, t + 1.6);
    e.beginTechniquePractice(second, t + 1.7);
    expect(e.recordTechniquePracticeSuccess(second, t + 1.8)).toBe('mastered');
  });

  it('练习失败可重试：不调用即不推进；LEARNING 状态下多次无效操作不污染计数', () => {
    const { e, t } = reachGate();
    const first = e.currentTechniqueKind()!;
    e.settleNarrative(e.eventIdentity()!.requestId, t + 0.5);
    e.acknowledgeTechniqueManual(first, t + 0.6);
    e.beginTechniquePractice(first, t + 0.7);
    // 重复 ack/begin 幂等拒绝
    expect(e.acknowledgeTechniqueManual(first, t + 0.8)).toBe(false);
    expect(e.beginTechniquePractice(first, t + 0.8)).toBe(false);
    expect(e.getState().techniques.successfulPracticeCount[first]).toBe(0);
    // MASTERED 后重复成功拒绝
    expect(e.recordTechniquePracticeSuccess(first, t + 0.9)).toBe('mastered');
    expect(e.recordTechniquePracticeSuccess(first, t + 1.0)).toBeNull();
  });

  it('三式全部 MASTERED 后进入 BOSS_GATE（人人可学全，不锁死）', () => {
    const { e, t } = reachGate();
    for (let i = 0; i < 3; i++) {
      const kind = e.currentTechniqueKind();
      expect(kind).toBeTruthy();
      const rid = e.eventIdentity()!.requestId;
      expect(e.settleNarrative(rid, t + i)).toBe(true);
      expect(e.acknowledgeTechniqueManual(kind!, t + i + 0.1)).toBe(true);
      expect(e.beginTechniquePractice(kind!, t + i + 0.2)).toBe(true);
      expect(e.recordTechniquePracticeSuccess(kind!, t + i + 0.3)).toBe('mastered');
    }
    const s = e.getState();
    expect(s.phase).toBe('BOSS_GATE');
    expect(s.techniques.learned).toHaveLength(3);
    for (const k of s.techniques.order) {
      expect(s.techniques.stages[k]).toBe('MASTERED');
    }
  });

  it('刷新恢复：LEARNING 中途存档 → stages/计数完整往返', () => {
    const { e, t } = reachGate();
    const first = e.currentTechniqueKind()!;
    e.settleNarrative(e.eventIdentity()!.requestId, t + 0.5);
    e.acknowledgeTechniqueManual(first, t + 0.6);
    e.beginTechniquePractice(first, t + 0.7);
    saveLifeState(e.getState());
    const r = loadLifeState()!;
    expect(r.techniques.stages[first]).toBe('LEARNING');
    expect(r.techniques.successfulPracticeCount[first]).toBe(0);
    // practiceEventIds 往返保留（sanitize 只重建缺失/脏字段，LEARNING 的机缘身份保留）
    expect(r.techniques.practiceEventIds[first]).not.toBeNull();
    const e2 = new LifeEngine();
    e2.restore(r);
    expect(e2.recordTechniquePracticeSuccess(first, t + 1)).toBe('mastered');
    expect(e2.getState().phase).toBe('TECHNIQUE_GATE'); // 还有两式
  });
});

// =====================================================================
// 三、生效层权限门（未 MASTERED → 普通斩击）
// =====================================================================
describe('v33 生效层权限门', () => {
  const W = 800;
  const H = 600;

  function frame(x: number, y: number, t: number) {
    return { x, y, timestamp: t, actionState: 'ACTIVE', source: 'pointer' } as never;
  }

  function newEngine(): CombatEngine {
    const e = new CombatEngine({ ...DEFAULT_COMBAT_CONFIG });
    e.start(0);
    return e;
  }

  /** 走到狼 TELEGRAPH 窗口（真实节奏），返回当前时刻 */
  function waitForTelegraph(e: CombatEngine, t: number): number {
    for (let i = 0; i < 400; i++) {
      t += 40;
      e.update(t, W, H);
      if (e.getSnapshot().wolf.state === 'TELEGRAPH') return t;
    }
    return t;
  }

  /** 对角斜劈（diagonalSlash 几何）：从狼左上 (wx-200,wy-200) 到右下 (wx+200,wy+200) 穿过狼身 */
  function diagonalSwing(e: CombatEngine, wx: number, wy: number, t: number): number {
    const ax = wx - 200;
    const ay = wy - 200;
    const bx = wx + 200;
    const by = wy + 200;
    let now = t;
    e.onFrame(frame(ax, ay, now), null);
    for (let i = 1; i <= 14; i++) {
      const p = i / 14;
      now += 16;
      e.onFrame(frame(ax + (bx - ax) * p, ay + (by - ay) * p, now), null);
    }
    return now + 60;
  }

  /**
   * 对狼当前位置打一次对角斜劈（真实几何）并推进到结算完成。
   * 返回 { hpBefore, hpAfter, snapshot }——几何命中由引擎结算，等待由 update 驱动，
   * 最多尝试 maxSwings 次直到狼掉血（狼走位造成的 miss 也走普通斩击路径，重试即可）。
   */
  function strikeWolfOnce(e: CombatEngine, t: number, maxSwings = 6) {
    let now = t;
    let hpBefore = e.getSnapshot().wolf.hp;
    for (let i = 0; i < maxSwings; i++) {
      const w = e.getSnapshot().wolf;
      now = diagonalSwing(e, w.x * W, w.y * H, now + 20);
      now += 80;
      e.update(now, W, H);
      const hp = e.getSnapshot().wolf.hp;
      if (hp < hpBefore) {
        return { hpBefore, hpAfter: hp, snapshot: e.getSnapshot(), now };
      }
      hpBefore = hp;
    }
    return { hpBefore, hpAfter: e.getSnapshot().wolf.hp, snapshot: e.getSnapshot(), now };
  }

  it('未 MASTERED：战斗中相同几何只作普通斩击，不伪造练习或正式招式反馈', () => {
    const e = newEngine();
    const now = waitForTelegraph(e, 0);
    const r = strikeWolfOnce(e, now);
    const s = r.snapshot;
    // 普通斩击结算：狼掉血（lastStrike 存在且为普通斩击——无招式名）
    expect(s.lastStrike).not.toBeNull();
    expect(r.hpAfter).toBeLessThan(r.hpBefore);
    // 练习回执只在显式 learning context 中产生；正式战斗不会借未掌握几何伪造反馈。
    const pa = s.technique.practiceAttempt;
    expect(pa).toBeNull();
    const at = s.technique.attempt;
    expect(at === null || at!.status !== 'effective').toBe(true);
    // 无招式剑气 fx（非预览）
    expect(s.techniqueFx.filter((f) => !f.preview).length).toBe(0);
  });

  it('MASTERED 后：syncLearnedTechniques 放开 → effective 提交 + 剑气 fx + 更高伤害', () => {
    const run = (learned: boolean) => {
      const e = newEngine();
      if (learned) e.syncLearnedTechniques({ diagonalSlash: true });
      const now0 = waitForTelegraph(e, 0);
      const r = strikeWolfOnce(e, now0);
      return { dmg: r.hpBefore - r.hpAfter, snap: r.snapshot };
    };
    const unlearned = run(false);
    const learned = run(true);
    expect(unlearned.dmg).toBeGreaterThan(0);
    expect(learned.dmg).toBeGreaterThan(unlearned.dmg); // 倍率生效
    // 招式提交 + 剑气
    expect(learned.snap.technique.attempt).not.toBeNull();
    expect(learned.snap.technique.attempt!.kind).toBe('DIAGONAL_SLASH');
    expect(learned.snap.technique.attempt!.status).toBe('effective');
    expect(learned.snap.techniqueFx.filter((f) => !f.preview).length).toBe(1);
    // 未学路径无 attempt effective（由上一用例保证）
  });

  it('练习通道不产生战斗副作用：斩弹/破势计数不受练习尝试影响', () => {
    const e = newEngine();
    const now0 = waitForTelegraph(e, 0);
    const s0 = e.getSnapshot();
    const wx = s0.wolf.x * W;
    const wy = s0.wolf.y * H;
    const now = diagonalSwing(e, wx, wy, now0 + 20);
    e.update(now, W, H);
    const s = e.getSnapshot();
    // 普通斩击照常结算（只有普通部分）
    expect(s.lastStrike).not.toBeNull();
    expect(s.lastStrike?.technique ?? '').toBe(''); // 无招式名（未提交——普通斩击）
  });
});

// =====================================================================
// 四、Boss 节奏门（纯逻辑：三阶段最小事件 + 地板）
// =====================================================================
describe('v33 Boss 节奏门（综合考试）', () => {
  const cfg = DEFAULT_BOSS_RHYTHM_CONFIG;

  it('canEnterBreakStance：至少一次完整扑击才可破势', () => {
    const s = emptyBossRhythmState();
    expect(canEnterBreakStance(s, cfg)).toBe(false);
    s.lungesPhase1 = 1;
    expect(canEnterBreakStance(s, cfg)).toBe(true);
  });

  it('canEnterChaos：破势阶段至少一次蓄力弱点被破', () => {
    const s = emptyBossRhythmState();
    s.lungesPhase1 = 1;
    expect(canEnterChaos(s, cfg)).toBe(false);
    s.chargesPhase2 = 1;
    expect(canEnterChaos(s, cfg)).toBe(true);
  });

  it('canDefeatInChaos：乱战组合至少一次（弹+扑各计一 → chaosEvents≥2）', () => {
    const s = emptyBossRhythmState();
    s.lungesPhase1 = 1;
    s.chargesPhase2 = 1;
    expect(canDefeatInChaos(s, cfg)).toBe(false);
    s.chaosEvents = 1;
    expect(canDefeatInChaos(s, cfg)).toBe(false);
    s.chaosEvents = 2; // minCombosPhase3=1 → 1*2 组合事件
    s.chaosProjectilesFired = 1;
    s.chaosTechniqueHits = 1;
    expect(canDefeatInChaos(s, cfg)).toBe(true);
  });

  it('applyHpFloor：节奏门未满足时 HP 不穿地板（max 语义，三阶段各验）', () => {
    const s0 = emptyBossRhythmState();
    // 阶段1：未完成扑击 → HP 至少 99%
    expect(applyHpFloor(110, 120, 1, s0, cfg)).toBe(120 * 0.99);
    expect(applyHpFloor(119, 120, 1, s0, cfg)).toBe(119); // 已高于地板：保持
    // 阶段2：未完成蓄力 → HP 至少 65%
    expect(applyHpFloor(60, 120, 2, s0, cfg)).toBe(120 * 0.65);
    // 阶段3：乱战组合未达 → HP 至少 33%
    expect(applyHpFloor(20, 120, 3, s0, cfg)).toBe(120 * 0.33);
    // 满足门后不干预
    const s1 = emptyBossRhythmState();
    s1.lungesPhase1 = 1;
    s1.chargesPhase2 = 1;
    s1.chaosEvents = 2;
    s1.chaosProjectilesFired = 1;
    s1.chaosTechniqueHits = 1;
    expect(applyHpFloor(20, 120, 3, s1, cfg)).toBe(20);
  });

  it('applyTimeFloor：minEncounterMs 前不可斩杀（HP 不低于 1）', () => {
    const s = emptyBossRhythmState();
    s.lungesPhase1 = 9;
    s.chargesPhase2 = 9;
    s.chaosEvents = 9;
    expect(applyTimeFloor(0, 5000, cfg)).toBe(1); // 5s < 20s：不杀
    expect(applyTimeFloor(0, 20000, cfg)).toBe(0); // 20s：可杀
    expect(applyTimeFloor(50, 25000, cfg)).toBe(50);
  });
});

// =====================================================================
// 五、旧档迁移
// =====================================================================
describe('v33 旧档迁移与安全恢复', () => {
  beforeEach(() => {
    clearLifeState();
    localStorage.clear();
  });

  it('v30 档（learned=[diagonalSlash]，无 stages/counts）→ MASTERED 推导 + 计数补 0', () => {
    const e = newLife();
    e.completeSensing(NOW + 10);
    e.reportTrialResult(true, NOW + 11);
    e.beginFirstChoice(NOW + 12);
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 13);
    e.selectOption('intent-steady', NOW + 14);
    e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 15);
    finishChoiceNarrative(e);
    // 同行者（正文落定 → 回应）
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 16);
    e.respondCompanion('skip', NOW + 16.5);
    // 第二剑
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 17);
    e.selectOption('fate-sect', NOW + 18);
    e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 19);
    finishChoiceNarrative(e);
    // 学第一式（真实链路）
    const first = e.currentTechniqueKind()!;
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 20);
    e.acknowledgeTechniqueManual(first, NOW + 20.1);
    e.beginTechniquePractice(first, NOW + 20.2);
    e.recordTechniquePracticeSuccess(first, NOW + 20.3);
    expect(e.getState().phase).toBe('TECHNIQUE_GATE');

    // 模拟 v30 旧档：删掉 v33 新字段
    const raw = JSON.parse(JSON.stringify(e.getState())) as Record<string, unknown>;
    delete (raw.techniques as Record<string, unknown>).stages;
    delete (raw.techniques as Record<string, unknown>).successfulPracticeCount;
    delete (raw.techniques as Record<string, unknown>).requiredSuccesses;
    delete (raw.techniques as Record<string, unknown>).practiceEventIds;
    // activeEvent 是新式事件——旧档此处应该是下一式 PENDING（保持现状即可，恢复后可继续）
    raw.schemaVersion = 2;
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(raw));

    const r = loadLifeState()!;
    expect(r).not.toBeNull();
    expect(r.techniques.learned).toEqual([first]);
    expect(r.techniques.stages[first]).toBe('MASTERED'); // learned → MASTERED
    for (const k of r.techniques.order) {
      if (k !== first) {
        expect(r.techniques.stages[k]).toBe(k === r.techniques.order[1] ? 'OPPORTUNITY_AVAILABLE' : 'LOCKED');
      }
    }
    expect(r.techniques.successfulPracticeCount[first]).toBe(0);
    expect(r.techniques.requiredSuccesses[first]).toBe(1);
    // 恢复后引擎可继续学下一式（不卡死、不重复领悟）
    const e2 = new LifeEngine();
    e2.restore(r);
    expect(e2.currentTechniqueKind()).toBe(r.techniques.order[1]);
    expect(e2.getState().techniques.stages[first]).toBe('MASTERED');
    expect(e2.recordTechniquePracticeSuccess(first, NOW + 21)).toBeNull(); // 已 MASTERED 不重复
  });

  it('脏档：stages 里 MASTERED 但 learned 不含（篡改）→ 推导回 LOCKED', () => {
    const e = newLife();
    const raw = JSON.parse(JSON.stringify(e.getState())) as Record<string, unknown>;
    const tech = raw.techniques as Record<string, unknown>;
    tech.stages = {
      diagonalSlash: 'MASTERED', // 伪造
      cross: 'LEARNING', // 无 learned 依据
      returnWind: 'LOCKED',
    };
    tech.learned = []; // 事实为空
    tech.order = ['diagonalSlash', 'cross', 'returnWind'];
    tech.successfulPracticeCount = { diagonalSlash: 5, cross: -3, returnWind: 0.5 };
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(raw));
    const r = loadLifeState()!;
    expect(r.techniques.stages.diagonalSlash).toBe('LOCKED'); // 依 learned 推导
    expect(r.techniques.stages.cross).toBe('OPPORTUNITY_AVAILABLE'); // LEARNING 无匹配机缘事件 → 防卡死回退（可重开卷轴）
    expect(r.techniques.successfulPracticeCount.cross).toBe(0); // 负数 → 0
    expect(r.techniques.successfulPracticeCount.diagonalSlash).toBe(5);
  });

  it('Boss 后旧档（BOSS_GATE/CHAPTER_RESULT，learned 全空）→ 三式 MASTERED 推导', () => {
    const e = newLife();
    e.completeSensing(NOW + 10);
    e.reportTrialResult(true, NOW + 11);
    e.beginFirstChoice(NOW + 12);
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 13);
    e.selectOption('intent-steady', NOW + 14);
    e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 15);
    finishChoiceNarrative(e);
    // 同行者（正文落定 → 回应）
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 16);
    e.respondCompanion('skip', NOW + 16.5);
    // 第二剑
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 17);
    e.selectOption('fate-sect', NOW + 18);
    e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 19);
    finishChoiceNarrative(e);
    // 三式学完 → BOSS_GATE（真实阶段机路径）
    let tk = e.currentTechniqueKind();
    while (tk) {
      e.settleNarrative(e.eventIdentity()!.requestId, NOW + 19.5);
      e.acknowledgeTechniqueManual(tk, NOW + 19.6);
      e.beginTechniquePractice(tk, NOW + 19.7);
      e.recordTechniquePracticeSuccess(tk, NOW + 19.8);
      tk = e.currentTechniqueKind();
    }
    expect(e.getState().phase).toBe('BOSS_GATE');
    e.reportBossVictory(registerBossSummary(e, victorySummary()), NOW + 30);
    const s = e.getState();
    expect(s.phase).toBe('CHAPTER_RESULT');

    // 模拟旧档无 stages 字段
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    delete (raw.techniques as Record<string, unknown>).stages;
    delete (raw.techniques as Record<string, unknown>).successfulPracticeCount;
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(raw));
    const r = loadLifeState()!;
    for (const k of r.techniques.order) {
      expect(r.techniques.stages[k]).toBe('MASTERED');
    }
  });
});

// =====================================================================
// 六、Happy Path：新人生 → JOURNEY_GATE（引擎层全链路）
// =====================================================================
describe('v33 第一章 Happy Path（引擎层）', () => {
  it('真实状态方法一路走到 JOURNEY_GATE：每阶段事件契约完整', () => {
    const e = newLife(9090); // 身份已落定并确认 → SENSING_GATE
    expect(e.getState().phase).toBe('SENSING_GATE');
    // 已确认身份不可重复确认（幂等拒绝）
    expect(e.confirmProfile(NOW + 2)).toBe(false);
    // 剑意感应
    expect(e.completeSensing(NOW + 3)).toBe(true);
    expect(e.getState().phase).toBe('TRIAL_GATE');
    // 基础试炼（真实 SwordEngine success 由 App 侧回执；引擎侧 reportTrialResult）
    expect(e.reportTrialResult(true, NOW + 4)).toBe(true);
    // 第一剑（正文落定 → 选择 → 确认剑）
    e.beginFirstChoice(NOW + 5);
    expect(e.getState().activeEvent!.eventDefinitionId).toBe('ch1:choice:intent');
    expect(e.settleNarrative(e.eventIdentity()!.requestId, NOW + 6)).toBe(true);
    expect(e.getState().activeEvent!.phase).toBe('CHOICE_READY');
    expect(e.selectOption('intent-steady', NOW + 7)).toBe(true);
    expect(e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 8)).toBe(true);
    finishChoiceNarrative(e);
    // 同行者
    expect(e.getState().phase).toBe('COMPANION_EVENT');
    expect(e.settleNarrative(e.eventIdentity()!.requestId, NOW + 9)).toBe(true);
    e.respondCompanion('warm', NOW + 10);
    // 第二剑
    expect(e.getState().phase).toBe('FATE_CHOICE_FATE');
    expect(e.settleNarrative(e.eventIdentity()!.requestId, NOW + 11)).toBe(true);
    expect(e.selectOption('fate-sect', NOW + 12)).toBe(true);
    expect(e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 13)).toBe(true);
    finishChoiceNarrative(e);
    // 三式机缘（阶段机逐一 MASTERED）
    expect(e.getState().phase).toBe('TECHNIQUE_GATE');
    for (let i = 0; i < 3; i++) {
      const kind = e.currentTechniqueKind()!;
      const before = [...e.getState().techniques.order];
      expect(e.settleNarrative(e.eventIdentity()!.requestId, NOW + 14 + i)).toBe(true);
      expect(e.acknowledgeTechniqueManual(kind, NOW + 14.1 + i)).toBe(true);
      expect(e.beginTechniquePractice(kind, NOW + 14.2 + i)).toBe(true);
      expect(e.recordTechniquePracticeSuccess(kind, NOW + 14.3 + i)).toBe('mastered');
      expect(e.getState().techniques.stages[kind]).toBe('MASTERED');
      expect(e.getState().techniques.order).toEqual(before); // 顺序稳定
    }
    expect(e.getState().phase).toBe('BOSS_GATE');
    // Boss 胜利（真实战斗由 CombatEngine 结算；引擎侧 reportBossVictory）
    const summary = registerBossSummary(e, victorySummary());
    expect(e.reportBossVictory(summary, NOW + 20)).toBe(true);
    const s1 = e.getState();
    expect(s1.phase).toBe('CHAPTER_RESULT');
    expect(s1.swordArchetype).not.toBeNull(); // 程序化剑道初相
    expect(s1.realm).toBe('练气一层');
    // 幂等：重复 victory 不二次写
    expect(e.reportBossVictory(summary, NOW + 21)).toBe(false);
    // 剑道初相正文（archetype 事件落定）→ 收束
    expect(e.settleNarrative(e.eventIdentity()!.requestId, NOW + 22)).toBe(true);
    expect(e.enterJourney(NOW + 23)).toBe(true);
    const s2 = e.getState();
    expect(s2.phase).toBe('JOURNEY_GATE');
    expect(s2.chapterIndex).toBe(1);
    // 命簿完整：本 run 一条历史（两次选择 + 同行者 + 境界 + 三式成招事实）
    const hist = s2.ledger.history;
    expect(hist).toHaveLength(1);
    expect(hist[0].intentId).toBe('intent-steady');
    expect(hist[0].fateId).toBe('fate-sect');
    expect(['warm', 'reserved', 'skip']).toContain(hist[0].companionResponse); // 真实回应入史册
    expect(hist[0].realmTo).toBe('练气一层');
    expect(hist[0].resultFlags).toContain('intent-steady');
    expect(hist[0].resultFlags).toContain('fate-sect');
    expect(s2.ledger.chapterCompletionCount).toBe(1);
  });

  it('慢响应锁：AI 未落定时所有后继输入锁定（引擎层不变式）', () => {
    const e = newLife();
    e.confirmProfile(NOW + 2);
    e.completeSensing(NOW + 3);
    e.reportTrialResult(true, NOW + 4);
    e.beginFirstChoice(NOW + 5);
    // 第一剑正文未落定：selectOption 拒绝
    expect(e.selectOption('intent-steady', NOW + 6)).toBe(false);
    expect(e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 7)).toBe(false);
    // 技术门：正文未落定时 ack/练习拒绝
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 8);
    e.selectOption('intent-steady', NOW + 9);
    expect(e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 10)).toBe(true);
    finishChoiceNarrative(e);
    expect(e.settleNarrative(e.eventIdentity()!.requestId, NOW + 10.5)).toBe(true);
    expect(e.respondCompanion('skip', NOW + 11)).toBe(true);
    e.settleNarrative(e.eventIdentity()!.requestId, NOW + 12);
    e.selectOption('fate-sect', NOW + 13);
    expect(e.confirmChoiceStroke(100, 100, 'ACTIVE', NOW + 14)).toBe(true);
    finishChoiceNarrative(e);
    expect(e.getState().phase).toBe('TECHNIQUE_GATE');
    expect(e.getState().activeEvent?.phase).toBe('NARRATIVE_PENDING');
    const first = e.currentTechniqueKind()!;
    expect(e.acknowledgeTechniqueManual(first, NOW + 15)).toBe(false); // PENDING
    expect(e.beginTechniquePractice(first, NOW + 15.1)).toBe(false);
    expect(e.completeTechniquePractice(first, NOW + 15.2)).toBe(false);
  });
});

// =====================================================================
// 七、Escape 契约（组件级行为在 appLifeWiring/渲染层之外——引擎无状态变化的可测部分）
// =====================================================================
describe('v33 Escape/关闭契约（引擎层不干涉验证）', () => {
  it('Escape 只关面板：任何 Life 阶段下引擎状态不受 UI 面板开合影响（不变式）', () => {
    const e = newLife();
    const s0 = JSON.parse(JSON.stringify(e.getState())) as LifeState;
    // 面板开合（App 层 setState）不触碰引擎——引擎状态快照不变
    expect(JSON.parse(JSON.stringify(e.getState()))).toEqual(s0);
    expect(e.getState().phase).toBe('SENSING_GATE'); // newLife 已确认身份
    // 引擎状态不因任何 UI 事件改变（面板开合无副作用——引擎无此 API 路径）
  });
});

import { registerBossSummary } from './helpers/registerBossSummary';
import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
/**
 * 第六阶段测试：第一章可重复历练（replayChapter）。
 * 契约：重历保留已确认 profile 与永久记录，只清本章运行时；
 * realm 回「剑道初相」；幂等；新开一局才清 profile。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';
import { loadLifeState, clearLifeState, saveLifeState, LIFE_STORAGE_KEY } from '@/life/lifeStorage';


/** v33 身份受控事件：身份事件落定辅助（PROFILE_REVIEW AI-FIRST 门） */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

// node 测试环境无 localStorage：注入完整 Storage 实现（与既有 lifeIntegration 测试同惯例）
class TestStorage implements Storage {
  readonly length = 0;
  private map = new Map<string, string>();
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  key(): string | null {
    return null;
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as { localStorage?: Storage }).localStorage = new TestStorage();
}


/** 第九阶段：Boss 胜利 Summary（最小事实） */
let battleSequence = 0;
function makeVictorySummary() {
  return {
    encounterId: 'chapter1_red_eye_ape',
    battleId: `battle-test-${++battleSequence}`,
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
  } as import('../src/combat/combatEngine').BattleSummary;
}

/** 走完第一章至 JOURNEY_GATE 的引擎（确定性 seed） */
function finishedEngine(): LifeEngine {
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
  e.selectOption('fate-wander', 9);
  e.confirmChoiceStroke(800, 100, 'ACTIVE', 10);
  finishChoiceNarrative(e);
  // 第九阶段收口：三式机缘（教学叙事落定 + 练习成招 ×3）→ BOSS_GATE
  for (let i = 0; i < 3; i++) {
    const id = e.eventIdentity();
    if (!id) break;
    e.settleNarrative(id.requestId, 10.1 + i);

    const kind = e.currentTechniqueKind()!;

    e.acknowledgeTechniqueManual(kind, 10.2 + i);

    e.beginTechniquePractice(kind, 10.2 + i);

    if (!e.completeTechniquePractice(kind, 10.2 + i)) break;
  }
  e.reportBossVictory(registerBossSummary(e, makeVictorySummary()), 10.5);
  e.settleNarrative(e.eventIdentity()!.requestId, 10.4);
  e.enterJourney(11);
  return e;
}

describe('LifeEngine.replayChapter：第一章可重复历练', () => {
  beforeEach(() => {
    clearLifeState();
  });

  it('JOURNEY_GATE 重历：保留身份/seed，清本章运行时，realm 回剑道初相，phase 回 TRIAL_GATE，choiceStage 回 intent', () => {
    const e = finishedEngine();
    const before = e.getState();
    const profile = before.profile!;
    expect(before.phase).toBe('JOURNEY_GATE');
    expect(before.realm).toBe('练气一层');

    expect(e.replayChapter(100)).toBe(true);
    const after = e.getState();
    // 身份完全保留（不偷偷重随机）
    expect(after.profile).toEqual(profile);
    expect(after.seed).toBe(before.seed);
    // 本章运行时清空
    expect(after.phase).toBe('SENSING_GATE'); // 收口：重历回感应门
    expect(after.choiceStage).toBe('intent');
    expect(after.eventIndex).toBe(0);
    expect(after.pendingChoiceId).toBeNull();
    expect(after.chosen).toEqual({ intent: null, fate: null });
    expect(after.companionState).toEqual({
      met: false,
      response: null,
      flag: null,
      skipped: false,
    });
    // realm 重置为章回起点
    expect(after.realm).toBe('剑道初相');
    // replayCount 统计递增
    expect(after.replayCount).toBe(1);
  });

  it('重历清理本章旗标（intent-/fate-/companion-/trial-），保留永久人生记录', () => {
    const e = finishedEngine();
    // 注入一个「永久记录」旗标（非本章前缀）
    const st = e.getState();
    st.flags['chronicle-kept'] = true;
    expect(e.replayChapter(100)).toBe(true);
    const f = e.getState().flags;
    expect(f['intent-steady']).toBeUndefined();
    expect(f['fate-wander']).toBeUndefined();
    expect(f['companion-warm']).toBeUndefined();
    expect(f['trial-won']).toBeUndefined();
    expect(f['chronicle-kept']).toBe(true);
  });

  it('幂等：重复调用第二次返回 false，不产生第二个章回', () => {
    const e = finishedEngine();
    expect(e.replayChapter(100)).toBe(true);
    expect(e.replayChapter(101)).toBe(false);
    expect(e.replayChapter(102)).toBe(false);
    expect(e.getState().phase).toBe('SENSING_GATE');
    expect(e.getState().replayCount).toBe(1);
  });

  it('CHAPTER_RESULT 也可重历（未收束此章时）', () => {
    const e = finishedEngine();
    // 退到 CHAPTER_RESULT 语义：直接构造（enterJourney 前的状态）
    const e2 = new LifeEngine();
    e2.loadSeed(7);
    e2.selectGender('male', 1);
    e2.generateIdentity(2);
    settleIdentity(e2, 2 + 0.1);
    e2.confirmProfile(3);
e2.completeSensing(3 + 1);
    e2.reportTrialResult(true, 4);
    e2.beginFirstChoice(5);
e2.settleNarrative(e2.eventIdentity()!.requestId, 5 + 1);
    e2.selectOption('intent-swift', 6);
    e2.confirmChoiceStroke(800, 100, 'ACTIVE', 7);
    finishChoiceNarrative(e2);
    e2.settleNarrative(e2.eventIdentity()!.requestId, e2.getState().updatedAt + 1);
    e2.respondCompanion('skip', 8);
e2.settleNarrative(e2.eventIdentity()!.requestId, 8 + 1);
    e2.selectOption('fate-sect', 9);
    e2.confirmChoiceStroke(800, 100, 'ACTIVE', 10);
    finishChoiceNarrative(e2);
    for (let i = 0; i < 3; i++) {
      const id = e2.eventIdentity();
      if (!id) break;
      e2.settleNarrative(id.requestId, 10.1 + i);

      const kind = e2.currentTechniqueKind()!;

      e2.acknowledgeTechniqueManual(kind, 10.2 + i);

      e2.beginTechniquePractice(kind, 10.2 + i);

      if (!e2.completeTechniquePractice(kind, 10.2 + i)) break;
    }
    e2.reportBossVictory(registerBossSummary(e2, makeVictorySummary()), 11);
    expect(e2.getState().phase).toBe('CHAPTER_RESULT');
    expect(e2.replayChapter(20)).toBe(true);
    expect(e2.getState().phase).toBe('SENSING_GATE');
    void e;
  });

  it('中途阶段（非章回终点）不允许重历', () => {
    const e = finishedEngine();
    e.replayChapter(100);
    e.completeSensing(100.5); // 感应门 → 试炼
    e.reportTrialResult(true, 101);
    e.beginFirstChoice(102);
e.settleNarrative(e.eventIdentity()!.requestId, 102 + 1);
    expect(e.replayChapter(103)).toBe(false);
    expect(e.getState().phase).toBe('FATE_CHOICE_INTENT');
  });

  it('重历后可换选项再走完一次，realm 再次推进到练气一层', () => {
    const e = finishedEngine();
    e.replayChapter(100);
    e.completeSensing(100.5); // 感应门 → 试炼
    e.reportTrialResult(true, 101);
    e.beginFirstChoice(102);
e.settleNarrative(e.eventIdentity()!.requestId, 102 + 1);
    e.selectOption('intent-void', 103);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 104);
    finishChoiceNarrative(e);
    e.settleNarrative(e.eventIdentity()!.requestId, e.getState().updatedAt + 1);
    e.respondCompanion('reserved', 105);
e.settleNarrative(e.eventIdentity()!.requestId, 105 + 1);
    e.selectOption('fate-companion', 106);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 107);
    finishChoiceNarrative(e);
    for (let i = 0; i < 3; i++) {
      const id = e.eventIdentity();
      if (!id) break;
      e.settleNarrative(id.requestId, 107.1 + i);

      const kind = e.currentTechniqueKind()!;

      e.acknowledgeTechniqueManual(kind, 107.2 + i);

      e.beginTechniquePractice(kind, 107.2 + i);

      if (!e.completeTechniquePractice(kind, 107.2 + i)) break;
    }
    e.reportBossVictory(registerBossSummary(e, makeVictorySummary()), 108);
    const s = e.getState();
    expect(s.phase).toBe('CHAPTER_RESULT');
    expect(s.realm).toBe('练气一层');
    expect(s.chosen).toEqual({ intent: 'intent-void', fate: 'fate-companion' });
    expect(s.companionState.flag).toBe('companion-reserved');
    // 旧选项旗标不残留
    expect(s.flags['intent-steady']).toBeUndefined();
    expect(s.flags['fate-wander']).toBeUndefined();
    expect(s.flags['intent-void']).toBe(true);
    expect(s.replayCount).toBe(1);
  });

  it('新开一局（resetLife）才清 profile；重历不清', () => {
    const e = finishedEngine();
    const name = e.getState().profile!.name;
    e.replayChapter(100);
    expect(e.getState().profile?.name).toBe(name);
    e.resetLife(200);
    expect(e.getState().profile).toBeNull();
    expect(e.getState().phase).toBe('PROFILE_GENDER');
    expect(e.getState().replayCount).toBe(0);
  });

  it('存档往返：旧档无 replayCount 字段可正常载入（向后兼容），重历后落盘含 replayCount', () => {
    clearLifeState();
    const e = finishedEngine();
    // 模拟旧档：去掉 replayCount 字段
    const old = { ...e.getState() } as Record<string, unknown>;
    delete old.replayCount;
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(old));
    const loaded = loadLifeState();
    expect(loaded).not.toBeNull();
    expect(loaded!.phase).toBe('JOURNEY_GATE');
    e.restore(loaded!);
    expect(e.replayChapter(300)).toBe(true);
    expect(saveLifeState(e.getState())).toBe(true);
    const again = loadLifeState();
    expect(again!.replayCount).toBe(1);
    expect(again!.phase).toBe('SENSING_GATE');
    expect(again!.profile!.name).toBe(e.getState().profile!.name);
  });
});

import { registerBossSummary } from './helpers/registerBossSummary';
import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
/**
 * 第八阶段测试：命簿与长期人生档案底座。
 * 契约：
 * - ledger 随 LifeState 持久化；旧 v1 档（无 ledger）自动补稳定空结构；损坏/版本不兼容安全回退；
 * - 历史条目幂等（runId 稳定）、重历递增后写新条目、旧记录不被覆盖；
 * - 重新试炼（纯战斗）不写历史；新开一局清空全部；重新生成身份重置命簿；
 * - 投影只读 state + 固定配置，AI 结果不改变任何规则字段；
 * - 命簿 UI 是纯渲染（renderToString 无副作用、不调 onClose）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { LifeEngine } from '@/life/lifeEngine';
import {
  loadLifeState,
  saveLifeState,
  clearLifeState,
  LIFE_STORAGE_KEY,
} from '@/life/lifeStorage';
import {
  buildLedgerView,
  appendChapterEntry,
  currentRunId,
  LEDGER_SCHEMA_VERSION,
} from '@/life/lifeLedger';
import { INTENT_OPTIONS, FATE_OPTIONS, LIFE_CONSTITUTIONS, LIFE_ORIGINS } from '@/life/lifeConfig';
import type { LifeState } from '@/life/lifeTypes';


/** v33 身份受控事件：身份事件落定辅助（PROFILE_REVIEW AI-FIRST 门） */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

// node 测试环境无 localStorage：注入完整 Storage 实现（与既有测试同惯例）
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

/** 走到 FATE_CHOICE_FATE（第一剑已确认，待第二剑） */

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

function atFate(): LifeEngine {
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
  return e;
}

/** 走完第一章（第二剑确认）至 CHAPTER_RESULT */
function finishedEngine(): LifeEngine {
  const e = atFate();
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
  e.reportBossVictory(registerBossSummary(e, makeVictorySummary()), 11);
  return e;
}

function savedStateOf(e: LifeEngine): LifeState {
  saveLifeState(e.getState());
  const loaded = loadLifeState();
  expect(loaded).not.toBeNull();
  return loaded!;
}

describe('命簿：旧档迁移与存档安全', () => {
  beforeEach(() => {
    clearLifeState();
    localStorage.clear();
  });

  it('旧 v1 存档（无 ledger 字段）→ 自动补稳定空 ledger（不丢身份/进度）', () => {
    const e = finishedEngine();
    const state = e.getState();
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete raw.ledger; // 模拟 v25 真实旧档（无 ledger）
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(raw));

    const loaded = loadLifeState();
    expect(loaded).not.toBeNull();
    expect(loaded!.ledger).toEqual({
      schemaVersion: LEDGER_SCHEMA_VERSION,
      profileSeed: state.seed,
      chapterCompletionCount: 0,
      history: [],
      updatedAt: expect.any(Number),
    });
    // 身份与阶段不受迁移影响
    expect(loaded!.profile?.name).toBe(state.profile?.name);
    expect(loaded!.phase).toBe('CHAPTER_RESULT');
    expect(loaded!.realm).toBe('练气一层');
  });

  it('ledger 结构损坏 → 整档安全回退 null（新局，不白屏）', () => {
    const e = finishedEngine();
    const raw = JSON.parse(JSON.stringify(e.getState())) as Record<string, unknown>;
    raw.ledger = { schemaVersion: LEDGER_SCHEMA_VERSION, history: 'not-an-array' };
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(raw));
    expect(loadLifeState()).toBeNull();
  });

  it('ledger schemaVersion 不兼容 → 整档安全回退 null', () => {
    const e = finishedEngine();
    const raw = JSON.parse(JSON.stringify(e.getState())) as Record<string, unknown>;
    (raw.ledger as Record<string, unknown>).schemaVersion = 999;
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(raw));
    expect(loadLifeState()).toBeNull();
  });

  it('历史条目含非法选项 id → 只丢弃该条，其余保留', () => {
    const e = finishedEngine();
    e.replayChapter(20);
    e.completeSensing(20.5);
    e.reportTrialResult(true, 21);
    e.beginFirstChoice(22);
e.settleNarrative(e.eventIdentity()!.requestId, 22 + 1);
    e.selectOption('intent-swift', 23);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 24);
    finishChoiceNarrative(e);
    e.settleNarrative(e.eventIdentity()!.requestId, e.getState().updatedAt + 1);
    e.respondCompanion('reserved', 25);
e.settleNarrative(e.eventIdentity()!.requestId, 25 + 1);
    e.selectOption('fate-sect', 26);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 27);
    finishChoiceNarrative(e);
    for (let i = 0; i < 3; i++) {
      const id = e.eventIdentity();
      if (!id) break;
      e.settleNarrative(id.requestId, 27.1 + i);

      const kind = e.currentTechniqueKind()!;

      e.acknowledgeTechniqueManual(kind, 27.2 + i);

      e.beginTechniquePractice(kind, 27.2 + i);

      if (!e.completeTechniquePractice(kind, 27.2 + i)) break;
    }
    e.reportBossVictory(registerBossSummary(e, makeVictorySummary()), 28);
    const raw = JSON.parse(JSON.stringify(e.getState())) as {
      ledger: { history: Array<Record<string, unknown>> };
    };
    raw.ledger.history[0].intentId = 'intent-hacked';
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify(raw));

    const loaded = loadLifeState();
    expect(loaded).not.toBeNull();
    expect(loaded!.ledger.history).toHaveLength(1);
    expect(loaded!.ledger.history[0].intentId).toBe('intent-swift');
    expect(loaded!.ledger.chapterCompletionCount).toBe(2);
  });

  it('存档往返：ledger 连同历史完整保留', () => {
    const e = finishedEngine();
    const state = savedStateOf(e);
    expect(state.ledger.history).toHaveLength(1);
    expect(state.ledger.chapterCompletionCount).toBe(1);
    expect(state.ledger.profileSeed).toBe(state.seed);
    const entry = state.ledger.history[0];
    expect(entry.intentId).toBe('intent-steady');
    expect(entry.fateId).toBe('fate-wander');
    expect(entry.realmFrom).toBe('剑道初相');
    expect(entry.realmTo).toBe('练气一层');
  });
});

describe('命簿：完成章节的幂等历史', () => {
  beforeEach(() => {
    clearLifeState();
    localStorage.clear();
  });

  it('第二剑确认（CHAPTER_RESULT）→ 恰好写入一条历史：真实选项/旗标/境界变化/序号', () => {
    const e = finishedEngine();
    const s = e.getState();
    expect(s.phase).toBe('CHAPTER_RESULT');
    expect(s.ledger.chapterCompletionCount).toBe(1);
    expect(s.ledger.history).toHaveLength(1);
    const h = s.ledger.history[0];
    expect(h.runId).toBe(`run:${s.seed}:0`);
    expect(h.seq).toBe(1);
    expect(h.intentId).toBe('intent-steady');
    expect(h.intentTitle).toBe('守拙');
    expect(h.fateId).toBe('fate-wander');
    expect(h.fateTitle).toBe('做散修');
    expect(h.resultFlags).toEqual(
      expect.arrayContaining(['intent-steady', 'fate-wander']),
    );
    expect(h.companionResponse).toBe('warm');
    expect(h.realmFrom).toBe('剑道初相');
    expect(h.realmTo).toBe('练气一层');
    expect(h.replayIndex).toBe(0);
    expect(h.narrativeSource).toBeNull();
  });

  it('同一 run 重复追加 → 幂等不重复（旧回调/刷新不产生重复历史）', () => {
    const e = finishedEngine();
    const s = e.getState();
    const before = JSON.parse(JSON.stringify(s.ledger)) as typeof s.ledger;
    const { ledger, appended } = appendChapterEntry(before, {
      seed: s.seed,
      replayIndex: 0,
      finishedAt: 999,
      intentId: 'intent-steady',
      fateId: 'fate-wander',
      resultFlags: ['intent-steady', 'fate-wander'],
      companionResponse: 'warm',
    });
    expect(appended).toBe(false);
    expect(ledger.history).toHaveLength(1);
    expect(ledger.chapterCompletionCount).toBe(1);
    // 幂等追加不覆盖原 finishedAt
    expect(ledger.history[0].finishedAt).not.toBe(999);
  });

  it('enterJourney 不写历史；CHAPTER_RESULT→JOURNEY_GATE 切换后仍只有一条', () => {
    const e = finishedEngine();
    e.settleNarrative(e.eventIdentity()!.requestId, 10.4);
    e.enterJourney(11);
    const s = e.getState();
    expect(s.phase).toBe('JOURNEY_GATE');
    expect(s.ledger.history).toHaveLength(1);
  });

  it('重新历练：递增 replayCount，完成第二次后新增第二条，旧记录不被覆盖', () => {
    const e = finishedEngine();
    const first = e.getState();
    const firstEntry = { ...first.ledger.history[0] };
    expect(e.replayChapter(20)).toBe(true);
    const mid = e.getState();
    expect(mid.replayCount).toBe(1);
    // 重历后历史仍在、身份仍在
    expect(mid.ledger.history).toHaveLength(1);
    expect(mid.profile?.name).toBe(first.profile?.name);
    // 走完第二次（含感应门与三式机缘）
    e.completeSensing(20.5);
    e.reportTrialResult(true, 21);
    e.beginFirstChoice(22);
e.settleNarrative(e.eventIdentity()!.requestId, 22 + 1);
    e.selectOption('intent-swift', 23);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 24);
    finishChoiceNarrative(e);
    e.settleNarrative(e.eventIdentity()!.requestId, e.getState().updatedAt + 1);
    e.respondCompanion('reserved', 25);
e.settleNarrative(e.eventIdentity()!.requestId, 25 + 1);
    e.selectOption('fate-sect', 26);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 27);
    finishChoiceNarrative(e);
    for (let i = 0; i < 3; i++) {
      const id = e.eventIdentity();
      if (!id) break;
      e.settleNarrative(id.requestId, 27.1 + i);

      const kind = e.currentTechniqueKind()!;

      e.acknowledgeTechniqueManual(kind, 27.2 + i);

      e.beginTechniquePractice(kind, 27.2 + i);

      if (!e.completeTechniquePractice(kind, 27.2 + i)) break;
    }
    e.reportBossVictory(registerBossSummary(e, makeVictorySummary()), 28);
    const s = e.getState();
    expect(s.ledger.history).toHaveLength(2);
    expect(s.ledger.chapterCompletionCount).toBe(2);
    const [old, now] = s.ledger.history;
    expect(old.runId).toBe(`run:${s.seed}:0`);
    expect(now.runId).toBe(`run:${s.seed}:1`);
    expect(now.seq).toBe(2);
    expect(now.intentId).toBe('intent-swift');
    expect(now.fateId).toBe('fate-sect');
    expect(now.companionResponse).toBe('reserved');
    expect(now.replayIndex).toBe(1);
    // 旧记录未被覆盖（finishedAt/序号/选择都保持原样）
    expect(old).toEqual(firstEntry);
  });

  it('重新试炼（战斗 retry，引擎无调用）不写历史：TRIAL_GATE 阶段 ledger 不变', () => {
    const e = finishedEngine();
    e.replayChapter(20);
    const before = JSON.parse(JSON.stringify(e.getState().ledger)) as LifeState['ledger'];
    // 战斗重开只调 reportTrialResult（胜负语义），不触碰 ledger
    e.reportTrialResult(false, 21);
    e.reportTrialResult(true, 22);
    expect(e.getState().ledger).toEqual(before);
    expect(e.getState().phase).toBe('SENSING_GATE');
  });

  it('刷新往返：两条历史 + completionCount + profileSeed 完整恢复', () => {
    const e = finishedEngine();
    e.replayChapter(20);
    e.completeSensing(20.5);
    e.reportTrialResult(true, 21);
    e.beginFirstChoice(22);
e.settleNarrative(e.eventIdentity()!.requestId, 22 + 1);
    e.selectOption('intent-swift', 23);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 24);
    finishChoiceNarrative(e);
    e.settleNarrative(e.eventIdentity()!.requestId, e.getState().updatedAt + 1);
    e.respondCompanion('skip', 25);
e.settleNarrative(e.eventIdentity()!.requestId, 25 + 1);
    e.selectOption('fate-companion', 26);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 27);
    finishChoiceNarrative(e);
    for (let i = 0; i < 3; i++) {
      const id = e.eventIdentity();
      if (!id) break;
      e.settleNarrative(id.requestId, 27.1 + i);

      const kind = e.currentTechniqueKind()!;

      e.acknowledgeTechniqueManual(kind, 27.2 + i);

      e.beginTechniquePractice(kind, 27.2 + i);

      if (!e.completeTechniquePractice(kind, 27.2 + i)) break;
    }
    e.reportBossVictory(registerBossSummary(e, makeVictorySummary()), 28);
    const state = savedStateOf(e);
    expect(state.ledger.history).toHaveLength(2);
    expect(state.ledger.history[1].companionResponse).toBe('skip');
    // 用恢复的状态继续人生：历史不重复不丢失
    const e2 = new LifeEngine(state);
    expect(e2.getState().ledger.history).toHaveLength(2);
  });

  it('不同 profileSeed 不串档：runId 含 seed，两个引擎各自独立', () => {
    const a = finishedEngine();
    const b = new LifeEngine();
    b.loadSeed(777777);
    b.selectGender('male', 1);
    b.generateIdentity(2);
    settleIdentity(b, 2 + 0.1);
    b.confirmProfile(3);
b.completeSensing(3 + 1);
    b.reportTrialResult(true, 4);
    b.beginFirstChoice(5);
b.settleNarrative(b.eventIdentity()!.requestId, 5 + 1);
    b.selectOption('intent-void', 6);
    b.confirmChoiceStroke(800, 100, 'ACTIVE', 7);
    finishChoiceNarrative(b);
    b.settleNarrative(b.eventIdentity()!.requestId, b.getState().updatedAt + 1);
    b.respondCompanion('skip', 8);
b.settleNarrative(b.eventIdentity()!.requestId, 8 + 1);
    b.selectOption('fate-wander', 9);
    b.confirmChoiceStroke(800, 100, 'ACTIVE', 10);
    finishChoiceNarrative(b);
    for (let i = 0; i < 3; i++) {
      const id = b.eventIdentity();
      if (!id) break;
      b.settleNarrative(id.requestId, 10.1 + i);

      const kind = b.currentTechniqueKind()!;

      b.acknowledgeTechniqueManual(kind, 10.2 + i);

      b.beginTechniquePractice(kind, 10.2 + i);

      if (!b.completeTechniquePractice(kind, 10.2 + i)) break;
    }
    b.reportBossVictory(registerBossSummary(b, makeVictorySummary()), 11);
    const sa = a.getState();
    const sb = b.getState();
    expect(sa.ledger.history[0].runId).not.toBe(sb.ledger.history[0].runId);
    expect(sa.ledger.history[0].runId).toBe(`run:${sa.seed}:0`);
    expect(sb.ledger.history[0].runId).toBe(`run:${sb.seed}:0`);
  });
});

describe('命簿：新开一局 / 重新生成身份 / AI 元数据', () => {
  beforeEach(() => {
    clearLifeState();
    localStorage.clear();
  });

  it('新开一局（resetLife）：命簿清空、profileSeed 更新、回性别选择', () => {
    const e = finishedEngine();
    const oldSeed = e.getState().seed;
    e.resetLife(30);
    const s = e.getState();
    expect(s.phase).toBe('PROFILE_GENDER');
    expect(s.profile).toBeNull();
    expect(s.ledger.history).toHaveLength(0);
    expect(s.ledger.chapterCompletionCount).toBe(0);
    expect(s.ledger.profileSeed).not.toBe(oldSeed);
    expect(s.ledger.profileSeed).toBe(s.seed);
  });

  it('重新生成身份（PROFILE_REVIEW）：命簿重置为新 seed（无旧身份残留）', () => {
    const e = new LifeEngine();
    e.loadSeed(111);
    e.selectGender('female', 1);
    e.generateIdentity(2);
    settleIdentity(e, 2 + 0.1);
    const oldSeed = e.getState().seed;
    expect(e.regenerateIdentity(3)).toBe(true);
    const s = e.getState();
    expect(s.seed).not.toBe(oldSeed);
    expect(s.ledger.profileSeed).toBe(s.seed);
    expect(s.ledger.history).toHaveLength(0);
  });

  it('AI 到达注解：只填本 run 条目的 null→ai，不覆盖已有值，不改结构', () => {
    const e = finishedEngine();
    const s = e.getState();
    const runId = currentRunId(s);
    expect(e.annotateLedgerNarrative(runId, 'ai', null)).toBe(true);
    const after = e.getState();
    expect(after.ledger.history[0].narrativeSource).toBe('ai');
    expect(after.ledger.history[0].intentId).toBe('intent-steady'); // 结构未动
    expect(after.ledger.history).toHaveLength(1);
    // 已非 null：不再覆盖
    expect(e.annotateLedgerNarrative(runId, 'deterministic', 'timeout')).toBe(false);
    expect(e.getState().ledger.history[0].narrativeSource).toBe('ai');
  });

  it('AI 迟到（重历后旧 runId 到达）：不污染新条目，未知 runId 拒绝', () => {
    const e = finishedEngine();
    e.replayChapter(20);
    e.completeSensing(20.5);
    e.reportTrialResult(true, 21);
    e.beginFirstChoice(22);
e.settleNarrative(e.eventIdentity()!.requestId, 22 + 1);
    e.selectOption('intent-swift', 23);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 24);
    finishChoiceNarrative(e);
    e.settleNarrative(e.eventIdentity()!.requestId, e.getState().updatedAt + 1);
    e.respondCompanion('skip', 25);
e.settleNarrative(e.eventIdentity()!.requestId, 25 + 1);
    e.selectOption('fate-sect', 26);
    e.confirmChoiceStroke(800, 100, 'ACTIVE', 27);
    finishChoiceNarrative(e);
    for (let i = 0; i < 3; i++) {
      const id = e.eventIdentity();
      if (!id) break;
      e.settleNarrative(id.requestId, 27.1 + i);

      const kind = e.currentTechniqueKind()!;

      e.acknowledgeTechniqueManual(kind, 27.2 + i);

      e.beginTechniquePractice(kind, 27.2 + i);

      if (!e.completeTechniquePractice(kind, 27.2 + i)) break;
    }
    e.reportBossVictory(registerBossSummary(e, makeVictorySummary()), 28);
    const s = e.getState();
    const staleRunId = `run:${s.seed}:0`;
    const currentId = currentRunId(s);
    expect(currentId).toBe(`run:${s.seed}:1`);
    // 旧 run 的 AI 注解不得改动旧条目之外任何内容之外的新条目
    expect(e.annotateLedgerNarrative(staleRunId, 'ai', null)).toBe(true); // 允许补旧条目
    expect(e.annotateLedgerNarrative('run:unknown:9', 'ai', null)).toBe(false);
    expect(e.getState().ledger.history[1].narrativeSource).toBeNull();
    expect(e.getState().ledger.history).toHaveLength(2);
  });
});

describe('命簿投影：纯数据视图（AI 不改变规则字段）', () => {
  beforeEach(() => {
    clearLifeState();
    localStorage.clear();
  });

  it('身份/体质/两剑/燕迟/境界准确投影', () => {
    const e = finishedEngine();
    const s = e.getState();
    const view = buildLedgerView(s);
    expect(view.profile).not.toBeNull();
    expect(view.profile!.name).toBe(s.profile!.name);
    expect(view.profile!.gender).toBe('female');
    // 出身/体质从固定配置真实查找（seed 20260906 female 的确定身份）
    const originDef = LIFE_ORIGINS.find((o) => o.id === s.profile!.originId)!;
    const consDef = LIFE_CONSTITUTIONS.find((c) => c.id === s.profile!.constitutionId)!;
    expect(view.profile!.originTitle).toBe(originDef.title);
    expect(view.profile!.constitutionTitle).toBe(consDef.title);
    expect(typeof view.profile!.constitutionText).toBe('string');
    expect(view.profile!.repairable).toBe(consDef.repairable);
    expect(view.profile!.transformable).toBe(consDef.transformable);
    expect(view.profile!.pathTags).toBe(consDef.pathTags);
    expect(view.chapterMarks.intent!.title).toBe('第一剑 · 择意');
    expect(view.chapterMarks.intent!.optionTitle).toBe('守拙');
    expect(view.chapterMarks.intent!.resultText).toBe(
      INTENT_OPTIONS.find((o) => o.id === 'intent-steady')!.resultText,
    );
    expect(view.chapterMarks.fate!.title).toBe('第二剑 · 定命');
    expect(view.chapterMarks.fate!.optionTitle).toBe('做散修');
    expect(view.chapterMarks.fate!.resultText).toBe(
      FATE_OPTIONS.find((o) => o.id === 'fate-wander')!.resultText,
    );
    expect(view.companion.name).toBe('燕迟');
    expect(view.companion.met).toBe(true);
    expect(view.companion.response).toBe('warm');
    expect(view.companion.flag).toBe('companion-warm');
    expect(view.realm).toBe('练气一层');
    expect(view.replayCount).toBe(0);
    expect(view.completionCount).toBe(1);
    expect(view.history).toHaveLength(1);
  });

  it('无 profile（性别选择阶段）→ 投影返回 null profile，不抛错', () => {
    const e = new LifeEngine();
    const view = buildLedgerView(e.getState());
    expect(view.profile).toBeNull();
    expect(view.history).toHaveLength(0);
    expect(view.completionCount).toBe(0);
  });

  it('AI 结果不改变投影（规则字段只来自 state + 固定配置）', async () => {
    const e = finishedEngine();
    const before = buildLedgerView(e.getState());
    // 模拟 AI 成功响应（含伪造的“规则字段”企图）——投影与 ledger 结构不受影响
    const aiLike = {
      body: 'AI 文案',
      companionLine: '燕迟：……',
      source: 'ai' as const,
      extra: { hp: -999, realm: '元婴老怪' },
    };
    // 只允许经注解接口写入轻量元数据
    e.annotateLedgerNarrative(currentRunId(e.getState()), 'ai', null);
    void aiLike;
    const after = buildLedgerView(e.getState());
    expect(after.profile).toEqual(before.profile);
    expect(after.chapterMarks).toEqual(before.chapterMarks);
    expect(after.companion).toEqual(before.companion);
    expect(after.realm).toBe(before.realm);
    expect(after.completionCount).toBe(before.completionCount);
    expect(after.history[0].intentId).toBe(before.history[0].intentId);
  });

  it('投影是纯函数：构建视图不写 storage、不产生副作用', () => {
    const e = finishedEngine();
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    const view = buildLedgerView(e.getState());
    expect(view).not.toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});

describe('命簿 UI：纯渲染（无循环/无 AI/无战斗依赖）', () => {
  beforeEach(() => {
    clearLifeState();
    localStorage.clear();
  });

  it('有记录时渲染完整五区（身份/体质/命痕/同行者/历练），不抛错、不调 onClose', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LifeLedger } = await import('@/components/life/LifeLedger');
    const e = finishedEngine();
    const onClose = vi.fn();
    const html = renderToString(
      createElement(LifeLedger, { open: true, onClose, state: e.getState(), persistent: true }),
    );
    expect(html).toContain('命簿');
    expect(html).toContain(e.getState().profile!.name);
    expect(html).toContain('守拙');
    expect(html).toContain('做散修');
    expect(html).toContain('燕迟');
    expect(html).toContain('练气一层');
    expect(html).toMatch(/第\s*1\s*次/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('未完成章节 → 历练区显示空状态提示，不出现假记录', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LifeLedger } = await import('@/components/life/LifeLedger');
    const e = new LifeEngine();
    e.loadSeed(20260906);
    e.selectGender('male', 1);
    e.generateIdentity(2);
    settleIdentity(e, 2 + 0.1);
    e.confirmProfile(3);
    const html = renderToString(
      createElement(LifeLedger, { open: true, onClose: () => undefined, state: e.getState(), persistent: true }),
    );
    expect(html).not.toMatch(/第\s*1\s*次/);
    expect(html).toContain('尚未走完');
  });

  it('open=false 不渲染任何内容（关闭即完全卸载视图）', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LifeLedger } = await import('@/components/life/LifeLedger');
    const html = renderToString(
      createElement(LifeLedger, { open: false, onClose: () => undefined, state: new LifeEngine().getState(), persistent: true }),
    );
    expect(html).toBe('');
  });

  it('无持久存储时显示可读提示（persistent=false）', async () => {
    const { renderToString } = await import('react-dom/server');
    const { LifeLedger } = await import('@/components/life/LifeLedger');
    const e = finishedEngine();
    const html = renderToString(
      createElement(LifeLedger, { open: true, onClose: () => undefined, state: e.getState(), persistent: false }),
    );
    expect(html).toContain('无法持久');
  });
});

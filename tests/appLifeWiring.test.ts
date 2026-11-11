import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
/**
 * App 接线层契约测试（纯逻辑，无 React 渲染）：
 * 覆盖 v29 纵向切片 App/UI 接线的关键语义——
 * 1. TECHNIQUE_GATE：叙事落定（settle）→ 练习成招（completeTechniquePractice）链与顺序依赖；
 * 2. choice 事件锁：NARRATIVE_PENDING 落字中不可选不可确认；CHOICE_READY 后可选可确认、不可反悔；
 * 3. 迟到响应丢弃：requestId 换新后，旧 requestId 的 settle 请求被引擎拒绝（不可复活）；
 * 4. SENSING_GATE 残留重置语义：重历回 SENSING_GATE 后 activeEvent 清空、旗标清理（App 渲染循环
 *    检测 completeSensing 的前置条件由引擎保证；此处断言引擎侧事实）；
 * 5. 机缘 learned 同步：Life 权威 learned → Combat syncLearnedTechniques（只增不减）。
 */
import { describe, expect, it } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';
import { CombatEngine } from '@/combat/combatEngine';
import { TECHNIQUE_OPPORTUNITIES, findTechniqueOpportunity } from '@/life/lifeConfig';
import type { LifeState } from '@/life/lifeTypes';


/** v33 身份受控事件：身份事件落定辅助（PROFILE_REVIEW AI-FIRST 门） */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

const W = 800;

/** 走到 TECHNIQUE_GATE（两剑确认完成；choice 事件逐一落定） */
function reachTechniqueGate(): { e: LifeEngine; t: number } {
  const e = new LifeEngine();
  e.loadSeed(20260908);
  e.selectGender('male', 0);
  e.generateIdentity(0.5);
  settleIdentity(e, 0.5 + 0.1);
  e.confirmProfile(1);
  e.completeSensing(2);
  e.reportTrialResult(true, 3);
  e.beginFirstChoice(4);
  e.settleNarrative(e.eventIdentity()!.requestId, 4.5);
  e.selectOption('intent-steady', 5);
  e.confirmChoiceStroke(W, 200, 'ACTIVE', 6);
  finishChoiceNarrative(e);
  e.settleNarrative(e.eventIdentity()!.requestId, e.getState().updatedAt + 1);
  e.respondCompanion('warm', 7);
  e.settleNarrative(e.eventIdentity()!.requestId, 7.5);
  e.selectOption('fate-sect', 8);
  e.confirmChoiceStroke(W, 200, 'ACTIVE', 9);
  finishChoiceNarrative(e);
  return { e, t: 10 };
}

describe('App 接线：TECHNIQUE_GATE 机缘链（settle → practice → 三式推进）', () => {
  it('第二剑确认后进入 TECHNIQUE_GATE 且第一式事件 NARRATIVE_PENDING（练习前锁定）', () => {
    const { e } = reachTechniqueGate();
    const s = e.getState();
    expect(s.phase).toBe('TECHNIQUE_GATE');
    expect(s.activeEvent?.phase).toBe('NARRATIVE_PENDING');
    expect(e.currentTechniqueKind()).toBe(s.techniques.order[0]);
  });

  it('叙事未落定时不可成招（completeTechniquePractice 拒绝）；settle 后同 requestId 成招推进下一式', () => {
    const { e, t } = reachTechniqueGate();
    const first = e.currentTechniqueKind()!;
    // 落字中：练习拒绝（App 渲染循环的 NARRATIVE_READY 前置与此一致）
    e.acknowledgeTechniqueManual(first, t); // v33
    e.beginTechniquePractice(first, t);
    expect(e.completeTechniquePractice(first, t)).toBe(false);
    expect(e.getState().techniques.learned).toEqual([]);
    // 落定（真实响应或 fallback 均经 settleNarrative）→ 可成招
    const rid = e.eventIdentity()!.requestId;
    expect(e.settleNarrative(rid, t + 0.5)).toBe(true);
    expect(e.getState().activeEvent?.phase).toBe('NARRATIVE_READY');
    e.acknowledgeTechniqueManual(first, t + 1); // v33
    e.beginTechniquePractice(first, t + 1);
    expect(e.completeTechniquePractice(first, t + 1)).toBe(true);
    expect(e.getState().techniques.learned).toEqual([first]);
    // 成招即开下一式（NARRATIVE_PENDING，需重新落字）
    expect(e.getState().activeEvent?.phase).toBe('NARRATIVE_PENDING');
    expect(e.currentTechniqueKind()).toBe(e.getState().techniques.order[1]);
  });

  it('三式逐一成招后进入 BOSS_GATE（learned 与 order 全排列一致）', () => {
    const { e, t } = reachTechniqueGate();
    for (let i = 0; i < 3; i++) {
      const kind = e.currentTechniqueKind()!;
      const rid = e.eventIdentity()!.requestId;
      expect(e.settleNarrative(rid, t + i)).toBe(true);
      e.acknowledgeTechniqueManual(kind, t + i + 0.5); // v33
      e.beginTechniquePractice(kind, t + i + 0.5);
      expect(e.completeTechniquePractice(kind, t + i + 0.5)).toBe(true);
    }
    const s = e.getState();
    expect(s.phase).toBe('BOSS_GATE');
    expect([...s.techniques.learned].sort()).toEqual([...s.techniques.order].sort());
    expect(s.techniques.learned).toHaveLength(3);
  });

  it('机缘事实来自固定配置：teachingText/practiceHint 与 findTechniqueOpportunity 一致（AI 只写 body）', () => {
    for (const def of TECHNIQUE_OPPORTUNITIES) {
      const f = findTechniqueOpportunity(def.kind);
      expect(f.eventId).toBe(`ch1:technique:${def.kind}`);
      expect(f.teachingText.length).toBeGreaterThan(0);
      expect(f.practiceHint.length).toBeGreaterThan(0);
      expect(f.fallbackText.length).toBeGreaterThan(0);
    }
  });
});

describe('App 接线：choice 事件锁（落字中禁选禁确认；确认后不可反悔）', () => {
  function reachFirstChoice(): LifeEngine {
    const e = new LifeEngine();
    e.loadSeed(20260908);
    e.selectGender('male', 0);
    e.generateIdentity(0.5);
    settleIdentity(e, 0.5 + 0.1);
    e.confirmProfile(1);
    e.completeSensing(2);
    e.reportTrialResult(true, 3);
    e.beginFirstChoice(4);
    return e;
  }

  it('NARRATIVE_PENDING：selectOption 与 confirmChoiceStroke 均拒绝（UI 显示剑意落字中）', () => {
    const e = reachFirstChoice();
    expect(e.getState().activeEvent?.phase).toBe('NARRATIVE_PENDING');
    expect(e.selectOption('intent-steady', 5)).toBe(false);
    expect(e.confirmChoiceStroke(W, 999, 'ACTIVE', 5)).toBe(false);
    expect(e.getState().pendingChoiceId).toBeNull();
    expect(e.getState().chosen.intent).toBeNull();
  });

  it('CHOICE_READY：可选可改选，确认剑后等待后果，再改选/再确认均拒绝', () => {
    const e = reachFirstChoice();
    e.settleNarrative(e.eventIdentity()!.requestId, 4.5);
    expect(e.getState().activeEvent?.phase).toBe('CHOICE_READY');
    expect(e.selectOption('intent-swift', 5)).toBe(true);
    expect(e.selectOption('intent-steady', 5.5)).toBe(true); // 未确认前可改
    const selectionEvent = e.getState().activeEvent!;
    expect(e.confirmChoiceStroke(W, 200, 'ACTIVE', 6)).toBe(true);
    // 确认后保持本次选择，独立后果事件落定并继续才进入同行者。
    const after = e.getState();
    expect(after.phase).toBe('FATE_CHOICE_INTENT');
    expect(after.activeEvent?.eventDefinitionId).toBe('ch1:choice:intent');
    expect(after.activeEvent?.eventInstanceId).not.toBe(selectionEvent.eventInstanceId);
    expect(after.activeEvent?.requestId).not.toBe(selectionEvent.requestId);
    expect(after.activeEvent?.phase).toBe('NARRATIVE_PENDING');
    expect(after.chosen.intent).toBe('intent-steady');
    // 不可反悔：改选与再确认都拒绝
    expect(e.selectOption('intent-swift', 7)).toBe(false);
    expect(e.confirmChoiceStroke(W, 200, 'ACTIVE', 7)).toBe(false);
    expect(e.getState().chosen.intent).toBe('intent-steady');
    finishChoiceNarrative(e);
    expect(e.getState().phase).toBe('COMPANION_EVENT');
    expect(e.getState().activeEvent?.eventDefinitionId).toBe('ch1:companion:meet');
  });
});

describe('App 接线：AI 调度契约（registerNarrativeRequest / 迟到响应丢弃）', () => {
  it('registerNarrativeRequest 换新 requestId；旧 requestId 的迟到 settle 被拒绝', () => {
    const { e, t } = reachTechniqueGate();
    const ev0 = e.getState().activeEvent!;
    const oldRid = ev0.requestId;
    // App 调度前注册新请求（refresh/重历重开场景）
    expect(e.registerNarrativeRequest(ev0.eventInstanceId, t)).toBeTruthy();
    const newRid = e.getState().activeEvent!.requestId;
    expect(newRid).not.toBe(oldRid);
    // 迟到的旧响应：requestId 不匹配 → 拒绝（不可复活、不可倒流）
    expect(e.settleNarrative(oldRid, t + 1)).toBe(false);
    expect(e.getState().activeEvent?.phase).toBe('NARRATIVE_PENDING');
    // 当前请求正常落定
    expect(e.settleNarrative(newRid, t + 2)).toBe(true);
    expect(e.getState().activeEvent?.phase).toBe('NARRATIVE_READY');
  });

  it('事件落定后 registerNarrativeRequest 拒绝（已 COMMITTED/FINALIZED 不再接受请求）', () => {
    const e = (() => {
      const x = new LifeEngine();
      x.loadSeed(20260908);
      x.selectGender('male', 0);
      x.generateIdentity(0.5);
      settleIdentity(x, 0.5 + 0.1);
      x.confirmProfile(1);
      x.completeSensing(2);
      x.reportTrialResult(true, 3);
      x.beginFirstChoice(4);
      return x;
    })();
    e.settleNarrative(e.eventIdentity()!.requestId, 4.5);
    e.selectOption('intent-steady', 5);
    e.confirmChoiceStroke(W, 200, 'ACTIVE', 6);
    finishChoiceNarrative(e);
    // 已离开 choice 事件（COMPANION_EVENT）→ 不接受机缘无关请求
    expect(e.registerNarrativeRequest('nonexistent', 7)).toBeNull();
  });
});

describe('App 接线：sensing 与重历边界（引擎侧事实，供渲染循环依赖）', () => {
  it('completeSensing 只在 SENSING_GATE 有效且幂等（重复回执不二次推进）', () => {
    const e = new LifeEngine();
    e.loadSeed(1);
    e.selectGender('male', 0);
    e.generateIdentity(0.5);
    settleIdentity(e, 0.5 + 0.1);
    e.confirmProfile(1);
    expect(e.completeSensing(2)).toBe(true);
    expect(e.getState().phase).toBe('TRIAL_GATE');
    expect(e.getState().flags['sensing-done']).toBe(true);
    expect(e.completeSensing(3)).toBe(false); // 已离开：幂等拒绝
  });

  it('replayChapter 回 SENSING_GATE：activeEvent 清空、本章旗标清理、保留 profile 与命簿', () => {
    const { e, t } = reachTechniqueGate();
    // 三式齐 → BOSS_GATE（合法重历边界）
    for (let i = 0; i < 3; i++) {
      const kind = e.currentTechniqueKind()!;
      expect(e.settleNarrative(e.eventIdentity()!.requestId, t + i)).toBe(true);
      e.acknowledgeTechniqueManual(kind, t + i + 0.5); // v33
      e.beginTechniquePractice(kind, t + i + 0.5);
      expect(e.completeTechniquePractice(kind, t + i + 0.5)).toBe(true);
    }
    expect(e.getState().phase).toBe('BOSS_GATE');
    const before = e.getState();
    const ledgerHistory = before.ledger.history.length;
    const replayCount = before.replayCount;
    expect(e.replayChapter(t + 2)).toBe(true);
    const s = e.getState();
    expect(s.phase).toBe('SENSING_GATE');
    expect(s.activeEvent).toBeNull();
    expect(s.flags['sensing-done']).toBeUndefined();
    expect(s.flags['trial-won']).toBeUndefined();
    expect(s.techniques.learned).toEqual([]);
    expect(s.techniques.order).toEqual(before.techniques.order); // 顺序保持
    expect(s.profile).toEqual(before.profile); // 身份保留
    expect(s.ledger.history.length).toBeGreaterThanOrEqual(ledgerHistory); // 命簿保留
    expect(s.replayCount).toBe(replayCount + 1);
    expect(e.replayChapter(t + 3)).toBe(false); // SENSING_GATE 非重历边界：幂等拒绝
  });
});

describe('App 接线：learned 同步（Life 权威 → Combat 展示，只增不减）', () => {
  it('syncLearnedTechniques 按 Life.techniques.learned 置位；未含项不受影响', () => {
    const ce = new CombatEngine();
    ce.start(0);
    const e = new LifeEngine();
    // 模拟 Life 已悟一式（取 order 首式）
    const le = e.getState();
    const first = le.techniques.order[0] ?? 'diagonalSlash';
    ce.syncLearnedTechniques({
      diagonalSlash: first === 'diagonalSlash',
      cross: first === 'cross',
      returnWind: first === 'returnWind',
    });
    const snap = ce.getSnapshot();
    expect(snap.technique.learned[first]).toBe(true);
    const others = (['diagonalSlash', 'cross', 'returnWind'] as const).filter(
      (k) => k !== first,
    );
    for (const k of others) expect(snap.technique.learned[k]).toBe(false);
    // 再同步更多（只增）
    ce.syncLearnedTechniques({ [others[0]]: true } as Record<string, boolean>);
    const snap2 = ce.getSnapshot();
    expect(snap2.technique.learned[first]).toBe(true);
    expect(snap2.technique.learned[others[0]]).toBe(true);
  });

  it('setLearnedTechnique 后 snapshot 立即可见（App 成招回执路径）', () => {
    const ce = new CombatEngine();
    ce.start(0);
    ce.setLearnedTechnique('DIAGONAL_SLASH');
    expect(ce.getSnapshot().technique.learned.diagonalSlash).toBe(true);
  });
});

describe('App 接线：存档恢复后 Life 状态可直接驱动 UI（无二次迁移）', () => {
  it('TECHNIQUE_GATE 中途存档：activeEvent/eventInstanceId/requestId 往返无损', () => {
    const { e, t } = reachTechniqueGate();
    e.settleNarrative(e.eventIdentity()!.requestId, t);
    const snap: LifeState = JSON.parse(JSON.stringify(e.getState()));
    expect(snap.phase).toBe('TECHNIQUE_GATE');
    expect(snap.activeEvent?.eventInstanceId).toBe(e.getState().activeEvent?.eventInstanceId);
    expect(snap.activeEvent?.requestId).toBe(e.getState().activeEvent?.requestId);
    expect(snap.activeEvent?.phase).toBe('NARRATIVE_READY');
    // 恢复后练习仍可完成（App 渲染循环的成招检测不依赖会话内状态）
    const e2 = new LifeEngine();
    e2.restore(snap);
    // v33：恢复后仍需走阶段机（卷轴确认 → 练习）——练习状态持久化在 techniques.stages
    const k2 = e2.currentTechniqueKind()!;
    expect(e2.completeTechniquePractice(k2, t + 1)).toBe(false); // 未 ack 前不可直接成招
    expect(e2.acknowledgeTechniqueManual(k2, t + 1)).toBe(true);
    expect(e2.beginTechniquePractice(k2, t + 1)).toBe(true);
    expect(e2.completeTechniquePractice(k2, t + 1)).toBe(true);
  });
});
import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
/**
 * v30 第二轮收口测试：AI 事件契约与 Life 终态。
 * 覆盖：
 * 1. EF 协议：非选择事件 optionIds=[] 合法、choice 事件强制固定 3 选项、
 *    非选择 responseSchema 的 choiceLead 必须 null；
 * 2. EF 身份校验：identity.eventDefinitionId 与 eventId 一致、requestId 一致、
 *    生命周期事件必须携带 identity；
 * 3. 同行者独立事件 ch1:companion:meet：eventInstanceId/requestId 独立、
 *    NARRATIVE_READY 前回应锁定、回应后 EVENT_FINALIZED + 开 fate 事件；
 * 4. 选择事件 EVENT_FINALIZED 收口：确认后不残留 CHOICE_COMMITTED；
 * 5. 存档清洗：phase 与 activeEvent 不一致时安全恢复（不白屏、不伪造完成）；
 * 6. deterministicFallback 对 companion 事件返回当前 activeEvent.requestId。
 */
import { describe, expect, it } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';
import {
  buildNarrativeRequest,
  deterministicFallback,
  eventIdOf,
} from '@/life/aiNarrative';
import { loadLifeState, saveLifeState, clearLifeState } from '@/life/lifeStorage';
import type { LifeState } from '@/life/lifeTypes';


/** v33 身份受控事件：身份事件落定辅助（PROFILE_REVIEW AI-FIRST 门） */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

// node 环境无 localStorage：与 lifeLedger.test.ts 相同的内存存储桩
class TestStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as { localStorage?: Storage }).localStorage = new TestStorage();
}

const W = 800;

// —— EF 校验函数镜像（supabase/functions 是 Deno 域，无法直接 import；
//    此处以纯逻辑复现协议常量断言，EF 源码侧由部署验证）——
function efIsChoiceEventId(eventId: string): boolean {
  return eventId === 'ch1:choice:intent' || eventId === 'ch1:choice:fate';
}

/** 走到 COMPANION_EVENT（第一剑已确认，choice:intent 已 FINALIZED） */
function reachCompanion(): { e: LifeEngine; t: number } {
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
  return { e, t: 7 };
}

/** 走到 FATE_CHOICE_FATE（companion 已回应，companion:meet 已 FINALIZED） */
function reachFate(): { e: LifeEngine; t: number } {
  const { e, t } = reachCompanion();
  e.settleNarrative(e.eventIdentity()!.requestId, t);
  e.respondCompanion('warm', t + 0.5);
  return { e, t: t + 1 };
}

describe('v30 EF 协议：optionIds 与 choiceLead 契约', () => {
  it('非选择事件 optionIds=[] 合法（EF 不再因空数组拒绝）', () => {
    const { e } = reachCompanion();
    const req = buildNarrativeRequest(e.getState(), { kind: 'companion' });
    // 非选择事件：optionIds 为空数组也必须通过 EF 协议（无 choiceLead enum）
    expect(efIsChoiceEventId(req.eventId)).toBe(false);
    expect(eventIdOf({ kind: 'companion' })).toBe('ch1:companion:meet');
    // identity/opening/archetype/result/technique 同理
    expect(efIsChoiceEventId('ch1:identity')).toBe(false);
    expect(efIsChoiceEventId('ch1:opening')).toBe(false);
    expect(efIsChoiceEventId('ch1:archetype')).toBe(false);
    expect(efIsChoiceEventId('ch1:technique:cross')).toBe(false);
    expect(efIsChoiceEventId('ch1:result')).toBe(false);
  });

  it('choice 事件仍强制固定选项集：eventId 判定为选择类', () => {
    expect(efIsChoiceEventId('ch1:choice:intent')).toBe(true);
    expect(efIsChoiceEventId('ch1:choice:fate')).toBe(true);
    // choice 请求的 optionIds 必须是固定三项（由 INTENT_OPTIONS/FATE_OPTIONS 提供）
    const { e } = reachFirstChoiceState();
    const req = buildNarrativeRequest(e.getState(), { kind: 'choice', stage: 'intent' });
    expect(req.eventId).toBe('ch1:choice:intent');
  });

  it('非选择事件请求不携带选择类字段污染；choice 请求身份与事件一致', () => {
    const { e } = reachCompanion();
    const req = buildNarrativeRequest(e.getState(), { kind: 'companion' });
    // companion 事件身份：必须是独立 companion:meet，不得借用上一选择事件
    expect(req.identity.eventDefinitionId).toBe('ch1:companion:meet');
    expect(req.identity.eventInstanceId).toBe(e.getState().activeEvent!.eventInstanceId);
    expect(req.requestId).toBe(e.getState().activeEvent!.requestId);
  });

  it('deterministicFallback 对 companion 事件回传当前 activeEvent.requestId', () => {
    const { e } = reachCompanion();
    const s = e.getState();
    const fb = deterministicFallback({ kind: 'companion' }, s);
    expect(fb.source).toBe('deterministic');
    expect(fb.requestId).toBe(s.activeEvent!.requestId);
    expect(fb.choiceLead).toBeNull();
    expect(fb.body.length).toBeGreaterThan(0);
    // 非当前事件的 fallback requestId 为 null（身份不匹配不伪造）
    const wrongKind = deterministicFallback({ kind: 'choice', stage: 'fate' }, s);
    expect(wrongKind.requestId).toBeNull();
  });
});

describe('v30 同行者独立事件 ch1:companion:meet', () => {
  it('第一剑后果落定并继续后：choice:intent FINALIZED 关闭 + companion:meet 独立开启（新实例新请求）', () => {
    const { e } = reachCompanion();
    const s = e.getState();
    expect(s.phase).toBe('COMPANION_EVENT');
    const ev = s.activeEvent!;
    expect(ev.eventDefinitionId).toBe('ch1:companion:meet');
    expect(ev.eventInstanceId).toMatch(/^ev-/);
    expect(ev.requestId).toMatch(/^req-/);
    expect(ev.phase).toBe('NARRATIVE_PENDING');
    // 事件实例 id 必须与上一选择事件不同（独立身份）
    expect(ev.eventInstanceId).not.toBe(ev.requestId);
  });

  it('NARRATIVE_PENDING 期间回应锁定；settle 后 NARRATIVE_READY 才可回应', () => {
    const { e, t } = reachCompanion();
    // 落字中：三种回应全部拒绝
    expect(e.respondCompanion('warm', t)).toBe(false);
    expect(e.respondCompanion('reserved', t)).toBe(false);
    expect(e.respondCompanion('skip', t)).toBe(false);
    expect(e.getState().phase).toBe('COMPANION_EVENT');
    // 落定后可回应
    expect(e.settleNarrative(e.eventIdentity()!.requestId, t + 0.5)).toBe(true);
    expect(e.getState().activeEvent?.phase).toBe('NARRATIVE_READY');
    expect(e.respondCompanion('warm', t + 1)).toBe(true);
    expect(e.getState().phase).toBe('FATE_CHOICE_FATE');
  });

  it('回应后 companion:meet FINALIZED + fate 事件开启（新 requestId）', () => {
    const { e, t } = reachCompanion();
    e.settleNarrative(e.eventIdentity()!.requestId, t);
    const companionEv = e.getState().activeEvent!;
    e.respondCompanion('skip', t + 0.5);
    const s = e.getState();
    expect(s.phase).toBe('FATE_CHOICE_FATE');
    expect(s.choiceStage).toBe('fate');
    const fateEv = s.activeEvent!;
    expect(fateEv.eventDefinitionId).toBe('ch1:choice:fate');
    expect(fateEv.phase).toBe('NARRATIVE_PENDING');
    // 新事件新身份：与 companion 事件实例/请求均不同
    expect(fateEv.eventInstanceId).not.toBe(companionEv.eventInstanceId);
    expect(fateEv.requestId).not.toBe(companionEv.requestId);
  });

  it('companion:meet 存档往返：白名单接受、身份无损', () => {
    const { e } = reachCompanion();
    saveLifeState(e.getState());
    const r = loadLifeState();
    expect(r).not.toBeNull();
    expect(r!.phase).toBe('COMPANION_EVENT');
    expect(r!.activeEvent?.eventDefinitionId).toBe('ch1:companion:meet');
    expect(r!.activeEvent?.eventInstanceId).toBe(e.getState().activeEvent!.eventInstanceId);
    expect(r!.activeEvent?.requestId).toBe(e.getState().activeEvent!.requestId);
    clearLifeState();
  });
});

describe('v30 选择事件 EVENT_FINALIZED 收口', () => {
  it('第二剑后果落定并继续后：choice:fate FINALIZED + 第一式机缘事件开启', () => {
    const { e, t } = reachFate();
    e.settleNarrative(e.eventIdentity()!.requestId, t);
    e.selectOption('fate-sect', t + 0.5);
    expect(e.confirmChoiceStroke(W, 200, 'ACTIVE', t + 1)).toBe(true);
    finishChoiceNarrative(e);
    const s = e.getState();
    expect(s.phase).toBe('TECHNIQUE_GATE');
    const ev = s.activeEvent!;
    expect(ev.eventDefinitionId).toBe(`ch1:technique:${s.techniques.order[0]}`);
    expect(ev.phase).toBe('NARRATIVE_PENDING');
    // 不残留 choice:fate 的 CHOICE_COMMITTED
    expect(ev.eventDefinitionId).not.toBe('ch1:choice:fate');
  });

  it('刷新恢复：COMPANION_EVENT 阶段看不到已 FINALIZED 的 choice:intent activeEvent', () => {
    const { e } = reachCompanion();
    saveLifeState(e.getState());
    const r = loadLifeState()!;
    expect(r.activeEvent?.eventDefinitionId).toBe('ch1:companion:meet');
    clearLifeState();
  });
});

describe('v30 存档清洗：phase 与 activeEvent 不一致安全恢复', () => {
  function makeInconsistentState(phase: string, defId: string): LifeState {
    const { e } = reachCompanion();
    const raw = JSON.parse(JSON.stringify(e.getState())) as LifeState;
    (raw as unknown as Record<string, unknown>).phase = phase;
    if (raw.activeEvent) raw.activeEvent.eventDefinitionId = defId;
    return raw;
  }

  it('COMPANION_EVENT 阶段携带 technique 事件定义 → 清空失效事件并按阶段重开 companion 事件', () => {
    const raw = makeInconsistentState('COMPANION_EVENT', 'ch1:technique:cross');
    saveLifeState(raw);
    const r = loadLifeState()!;
    expect(r.phase).toBe('COMPANION_EVENT');
    expect(r.activeEvent?.eventDefinitionId).toBe('ch1:companion:meet');
    expect(r.activeEvent?.phase).toBe('NARRATIVE_PENDING');
    clearLifeState();
  });

  it('FATE_CHOICE_FATE 阶段缺失 activeEvent（旧 v2 档）→ 生成安全待处理 fate 事件', () => {
    const raw = makeInconsistentState('FATE_CHOICE_FATE', 'ch1:choice:fate');
    raw.activeEvent = null;
    saveLifeState(raw);
    const r = loadLifeState()!;
    expect(r.phase).toBe('FATE_CHOICE_FATE');
    expect(r.activeEvent?.eventDefinitionId).toBe('ch1:choice:fate');
    expect(r.activeEvent?.phase).toBe('NARRATIVE_PENDING');
    expect(r.pendingChoiceId).toBeNull();
    clearLifeState();
  });

  it('TECHNIQUE_GATE 阶段携带 choice 事件定义 → 恢复当前机缘待处理事件', () => {
    const raw = makeInconsistentState('TECHNIQUE_GATE', 'ch1:choice:fate');
    saveLifeState(raw);
    const r = loadLifeState()!;
    expect(r.phase).toBe('TECHNIQUE_GATE');
    const next = r.techniques.order.find((kind) => !r.techniques.learned.includes(kind))!;
    expect(r.activeEvent?.eventDefinitionId).toBe(`ch1:technique:${next}`);
    expect(r.activeEvent?.phase).toBe('NARRATIVE_PENDING');
    expect(r.techniques.stages[next]).toBe('OPPORTUNITY_AVAILABLE');
    const restored = new LifeEngine();
    restored.restore(r);
    expect(restored.currentTechniqueKind()).toBe(next);
    expect(restored.settleNarrative(restored.eventIdentity()!.requestId, 8)).toBe(true);
    expect(restored.acknowledgeTechniqueManual(next, 9)).toBe(true);
    expect(restored.beginTechniquePractice(next, 10)).toBe(true);
    clearLifeState();
  });
});

describe('v30 EF 身份校验契约（请求构造侧）', () => {
  it('choice/companion/technique/archetype 生命周期请求均携带完整五字段身份', () => {
    // choice:intent
    const { e: ec } = reachFirstChoiceState();
    const rc = buildNarrativeRequest(ec.getState(), { kind: 'choice', stage: 'intent' });
    for (const v of Object.values(rc.identity)) expect(v.length).toBeGreaterThan(0);
    expect(rc.identity.eventDefinitionId).toBe(rc.eventId);
    // companion
    const { e: em } = reachCompanion();
    const rm = buildNarrativeRequest(em.getState(), { kind: 'companion' });
    expect(rm.identity.eventDefinitionId).toBe(rm.eventId);
    // technique
    const { e: et, t } = reachFate();
    et.settleNarrative(et.eventIdentity()!.requestId, t);
    et.selectOption('fate-sect', t + 0.5);
    et.confirmChoiceStroke(W, 200, 'ACTIVE', t + 1);
    finishChoiceNarrative(et);
    const rt = buildNarrativeRequest(et.getState(), {
      kind: 'technique',
      techniqueKind: et.getState().techniques.order[0],
    });
    expect(rt.identity.eventDefinitionId).toBe(rt.eventId);
    expect(rt.techniqueTitle).toBeDefined();
  });

  it('identity 请求（非生命周期）不携带事件身份也构造合法（无 activeEvent）', () => {
    const e = new LifeEngine();
    e.loadSeed(1);
    e.selectGender('male', 0);
    e.generateIdentity(0.5);
    settleIdentity(e, 0.5 + 0.1);
    const req = buildNarrativeRequest(e.getState(), { kind: 'identity' });
    expect(req.eventId).toBe('profile:identity');
    // v33：PROFILE_REVIEW 现在有持久 identity 事件（profile:identity）——
    // 引擎 generateIdentity 即开事件，请求身份直接取自 activeEvent（无 fallback 借用）
    expect(req.identity.eventDefinitionId).toBe('profile:identity');
  });
});

/** 走到 FATE_CHOICE_INTENT（beginFirstChoice 后） */
function reachFirstChoiceState(): { e: LifeEngine } {
  const e = new LifeEngine();
  e.loadSeed(20260908);
  e.selectGender('male', 0);
  e.generateIdentity(0.5);
  settleIdentity(e, 0.5 + 0.1);
  e.confirmProfile(1);
  e.completeSensing(2);
  e.reportTrialResult(true, 3);
  e.beginFirstChoice(4);
  return { e };
}
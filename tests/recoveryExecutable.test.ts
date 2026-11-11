import { afterEach, describe, expect, it, vi } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';
import { INTENT_OPTIONS } from '@/life/lifeConfig';
import { LIFE_STORAGE_KEY, loadLifeState, saveLifeState } from '@/life/lifeStorage';
import type { ActiveLifeEvent, LifePhase, LifeState } from '@/life/lifeTypes';

function initial(phase: LifePhase): LifeState {
  const engine = new LifeEngine();
  engine.loadSeed(777);
  engine.selectGender('male', 1);
  engine.generateIdentity(2);
  engine.settleNarrative(engine.eventIdentity()!.requestId, 3);
  engine.confirmProfile(4);
  const state = structuredClone(engine.getState());
  state.phase = phase;
  state.activeEvent = null;
  return state;
}

function recover(raw: unknown): LifeState {
  const values = new Map<string, string>([[LIFE_STORAGE_KEY, JSON.stringify(raw)]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const state = loadLifeState();
  expect(state).not.toBeNull();
  return state!;
}

function event(definition: string, phase: ActiveLifeEvent['phase'] = 'NARRATIVE_READY'): ActiveLifeEvent {
  return { eventDefinitionId: definition, eventInstanceId: 'event-valid', requestId: 'request-valid', phase, chosenOptionId: null, startedAt: 4 };
}

afterEach(() => vi.unstubAllGlobals());

describe('旧存档恢复后拥有可执行的下一步', () => {
  it.each([
    ['PROFILE_REVIEW', 'profile:identity'],
    ['FATE_CHOICE_INTENT', 'ch1:choice:intent'],
    ['FATE_CHOICE_FATE', 'ch1:choice:fate'],
    ['COMPANION_EVENT', 'ch1:companion:meet'],
    ['CHAPTER_RESULT', 'ch1:archetype'],
  ] as const)('v1 %s 迁移后可落定并继续', (phase, definition) => {
    const state = recover({ ...initial(phase), schemaVersion: 1 });
    expect(state.activeEvent?.eventDefinitionId).toBe(definition);
    const engine = new LifeEngine();
    engine.restore(state);
    expect(engine.settleNarrative(state.activeEvent!.requestId, 5)).toBe(true);
    if (phase === 'PROFILE_REVIEW') expect(engine.confirmProfile(6)).toBe(true);
    if (phase === 'FATE_CHOICE_INTENT') expect(engine.selectOption('intent-steady', 6)).toBe(true);
    if (phase === 'FATE_CHOICE_FATE') expect(engine.selectOption('fate-sect', 6)).toBe(true);
    if (phase === 'COMPANION_EVENT') expect(engine.respondCompanion('skip', 6)).toBe(true);
    if (phase === 'CHAPTER_RESULT') expect(engine.enterJourney(6)).toBe(true);
  });

  it.each([false, true])('CHAPTER_EVENT 根据感应事实迁移，保留身份及旗标 (%s)', (sensed) => {
    const raw = initial('CHAPTER_EVENT');
    raw.flags = { 'sensing-done': sensed, 'user-fact': true };
    const state = recover(raw);
    expect(state.phase).toBe(sensed ? 'TRIAL_GATE' : 'SENSING_GATE');
    expect(state.profile).toEqual(raw.profile);
    expect(state.flags).toEqual(raw.flags);
    const engine = new LifeEngine();
    engine.restore(state);
    expect(sensed ? engine.reportTrialResult(true, 5) : engine.completeSensing(5)).toBe(true);
  });

  it('三式 READY 旧档缺 stages 时可看卷轴、练习及成招', () => {
    const raw = initial('TECHNIQUE_GATE');
    const first = raw.techniques.order[0];
    raw.activeEvent = event(`ch1:technique:${first}`);
    const oldTechniques = { ...raw.techniques };
    delete (oldTechniques as Partial<typeof oldTechniques>).stages;
    const state = recover({ ...raw, techniques: oldTechniques });
    const engine = new LifeEngine();
    engine.restore(state);
    expect(engine.acknowledgeTechniqueManual(first, 5)).toBe(true);
    expect(engine.beginTechniquePractice(first, 6)).toBe(true);
    expect(engine.recordTechniquePracticeSuccess(first, 7)).toBe('mastered');
  });

  it.each([1, 2])('v%s 缺失机缘事件时重建首个未学招式并可完成', (schemaVersion) => {
    const raw = initial('TECHNIQUE_GATE');
    raw.techniques.learned = [raw.techniques.order[0]];
    const state = recover({ ...raw, schemaVersion });
    const current = state.techniques.order.find((kind) => !state.techniques.learned.includes(kind))!;
    expect(state.activeEvent?.eventDefinitionId).toBe(`ch1:technique:${current}`);
    const engine = new LifeEngine();
    engine.restore(state);
    expect(engine.settleNarrative(state.activeEvent!.requestId, 5)).toBe(true);
    expect(engine.acknowledgeTechniqueManual(current, 6)).toBe(true);
    expect(engine.beginTechniquePractice(current, 7)).toBe(true);
    expect(engine.recordTechniquePracticeSuccess(current, 8)).toBe('mastered');
  });

  it.each(['MANUAL_RECEIVED', 'LEARNING'] as const)('有效 %s 进度与计数保持，可继续成招', (stage) => {
    const raw = initial('TECHNIQUE_GATE');
    const [learned, current] = raw.techniques.order;
    raw.techniques.learned = [learned];
    raw.techniques.stages[current] = stage;
    raw.techniques.successfulPracticeCount[current] = 2;
    raw.activeEvent = event(`ch1:technique:${current}`);
    raw.techniques.practiceEventIds[current] = { eventInstanceId: raw.activeEvent.eventInstanceId, requestId: raw.activeEvent.requestId };
    const state = recover(raw);
    expect(state.techniques.stages[learned]).toBe('MASTERED');
    expect(state.techniques.stages[current]).toBe(stage);
    expect(state.techniques.successfulPracticeCount[current]).toBe(2);
    expect(state.activeEvent).toEqual(raw.activeEvent);
    expect(state.techniques.practiceEventIds[current]).toEqual(raw.techniques.practiceEventIds[current]);
    const engine = new LifeEngine();
    engine.restore(state);
    if (stage === 'MANUAL_RECEIVED') expect(engine.beginTechniquePractice(current, 5)).toBe(true);
    expect(engine.recordTechniquePracticeSuccess(current, 6)).toBe('mastered');
  });

  it('活动机缘已学时，保留已学事实并重建下一式', () => {
    const raw = initial('TECHNIQUE_GATE');
    const [learned, next] = raw.techniques.order;
    raw.techniques.learned = [learned];
    raw.activeEvent = event(`ch1:technique:${learned}`, 'EVENT_FINALIZED');
    const state = recover(raw);
    expect(state.techniques.stages[learned]).toBe('MASTERED');
    expect(state.activeEvent?.eventDefinitionId).toBe(`ch1:technique:${next}`);
    expect(state.techniques.stages[next]).toBe('OPPORTUNITY_AVAILABLE');
  });

  it('三式全已学的 TECHNIQUE_GATE 进入 Boss 门', () => {
    const raw = initial('TECHNIQUE_GATE');
    raw.techniques.learned = [...raw.techniques.order];
    expect(recover(raw).phase).toBe('BOSS_GATE');
  });

  it('结算缺事件时重建初相并允许进入九州', () => {
    const state = recover(initial('CHAPTER_RESULT'));
    expect(state.activeEvent?.eventDefinitionId).toBe('ch1:archetype');
    const engine = new LifeEngine();
    engine.restore(state);
    expect(engine.settleNarrative(state.activeEvent!.requestId, 5)).toBe(true);
    expect(engine.enterJourney(6)).toBe(true);
  });

  it.each(['CHOICE_COMMITTED', 'EVENT_FINALIZED', 'CHOICE_READY', 'NARRATIVE_READY'] as const)('已选事实恢复 %s 时不重新选择', (phase) => {
    const raw = initial('FATE_CHOICE_INTENT');
    raw.chosen.intent = 'intent-steady';
    raw.activeEvent = event('ch1:choice:intent', phase);
    raw.activeEvent.chosenOptionId = 'intent-steady';
    const state = recover(raw);
    expect(state.chosen.intent).toBe('intent-steady');
    expect(state.activeEvent?.chosenOptionId).toBe('intent-steady');
    expect(state.activeEvent?.phase).toBe(phase === 'NARRATIVE_READY' ? 'NARRATIVE_READY' : 'NARRATIVE_PENDING');
    expect(state.pendingChoiceId).toBeNull();
    const engine = new LifeEngine();
    engine.restore(state);
    expect(engine.selectOption(INTENT_OPTIONS.find((option) => option.id !== 'intent-steady')!.id, 5)).toBe(false);
  });

  it('事件已提交但 chosen 缺事实时恢复原选择与对应结果旗标', () => {
    const raw = initial('FATE_CHOICE_INTENT');
    raw.activeEvent = event('ch1:choice:intent', 'CHOICE_COMMITTED');
    raw.activeEvent.chosenOptionId = INTENT_OPTIONS[0].id;
    const state = recover(raw);
    expect(state.chosen.intent).toBe(INTENT_OPTIONS[0].id);
    for (const flag of INTENT_OPTIONS[0].resultFlags) expect(state.flags[flag]).toBe(true);
    expect(state.activeEvent?.phase).toBe('NARRATIVE_PENDING');
  });

  it('补建请求跨人生不共用固定身份，保存再载入保持稳定', () => {
    const first = recover(initial('COMPANION_EVENT'));
    const second = recover(initial('COMPANION_EVENT'));
    expect(first.activeEvent?.eventInstanceId).not.toBe(second.activeEvent?.eventInstanceId);
    expect(first.activeEvent?.requestId).not.toBe(second.activeEvent?.requestId);
    saveLifeState(second);
    expect(loadLifeState()?.activeEvent).toEqual(second.activeEvent);
  });
});

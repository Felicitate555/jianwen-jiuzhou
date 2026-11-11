import { describe, expect, it } from 'vitest';
import type { BattleSummary } from '@/combat/combatEngine';
import { LifeEngine } from '@/life/lifeEngine';
import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
import { registerBossSummary } from './helpers/registerBossSummary';

/** Reach the encounter through confirmed narrative and current learning receipts. */
function atBossGate(): LifeEngine {
  const engine = new LifeEngine();
  let now = 0;
  const settle = () => expect(engine.settleNarrative(engine.eventIdentity()!.requestId, ++now)).toBe(true);
  expect(engine.selectGender('male', ++now)).toBe(true);
  expect(engine.generateIdentity(++now)).toBe(true);
  settle();
  expect(engine.confirmProfile(++now)).toBe(true);
  expect(engine.completeSensing(++now)).toBe(true);
  expect(engine.reportTrialResult(true, ++now)).toBe(true);
  expect(engine.beginFirstChoice(++now)).toBe(true);
  settle();
  expect(engine.selectOption('intent-steady', ++now)).toBe(true);
  expect(engine.confirmChoiceStroke(800, 100, 'ACTIVE', ++now)).toBe(true);
  finishChoiceNarrative(engine);
  settle();
  expect(engine.respondCompanion('skip', ++now)).toBe(true);
  settle();
  expect(engine.selectOption('fate-sect', ++now)).toBe(true);
  expect(engine.confirmChoiceStroke(800, 100, 'ACTIVE', ++now)).toBe(true);
  finishChoiceNarrative(engine);
  for (let index = 0; index < 3; index++) {
    const kind = engine.currentTechniqueKind()!;
    settle();
    expect(engine.acknowledgeTechniqueManual(kind, ++now)).toBe(true);
    expect(engine.beginTechniquePractice(kind, ++now)).toBe(true);
    const session = engine.getPracticeSession(++now)!;
    expect(session).not.toBeNull();
    const required = engine.getState().techniques.requiredSuccesses[kind];
    for (let segmentId = 1; segmentId <= required; segmentId++) {
      const receipt = { ...session, segmentId, createdAt: ++now };
      expect(engine.acceptPracticeReceipt(receipt, now)).toBe(segmentId === required ? 'mastered' : 'counting');
    }
  }
  expect(engine.getState().phase).toBe('BOSS_GATE');
  return engine;
}

function summary(battleId = 'battle-current', result: BattleSummary['result'] = 'victory'): BattleSummary {
  return {
    encounterId: 'chapter1_red_eye_ape', battleId, result,
    duration: 75000, slashCount: 18, techniqueUsage: [], projectilesCut: 2,
    blocks: 3, interrupts: 1, breakStanceCount: 1, averageSpeed: 2.1,
    accuracyScore: 82, stabilityScore: 85, weakPointHits: 1,
    qiDepletedCount: 0, damageTaken: 12, overspeedCount: 0,
  };
}

describe('Boss settlement receipt identity', () => {
  it.each([
    ['life', { lifeId: 'life-stale' }],
    ['chapter', { chapterInstanceId: 'chapter-stale' }],
    ['battle', { battleId: 'battle-unregistered' }],
    ['encounter', { encounterId: 'another-encounter' }],
    ['result', { result: 'defeat' }],
    ['missing identity', { lifeId: undefined, chapterInstanceId: undefined }],
  ] satisfies [string, Partial<BattleSummary>][])('rejects an incorrect %s without changing progression', (_field, override) => {
    const engine = atBossGate();
    const current = registerBossSummary(engine, summary());
    const before = structuredClone(engine.getState());
    expect(engine.reportBossVictory({ ...current, ...override }, 100)).toBe(false);
    expect(engine.getState()).toEqual(before);
    expect(engine.reportBossVictory(current, 101)).toBe(true);
  });

  it('rejects an unregistered receipt and settles the same victory exactly once', () => {
    const engine = atBossGate();
    const { lifeId, chapterInstanceId } = engine.getState();
    const current = { ...summary(), lifeId, chapterInstanceId };
    expect(engine.reportBossVictory(current, 100)).toBe(false);
    expect(engine.registerBossBattle(current.battleId)).toBe(true);
    expect(engine.reportBossVictory(current, 101)).toBe(true);
    const settled = structuredClone(engine.getState());
    expect(engine.reportBossVictory(current, 102)).toBe(false);
    expect(engine.registerBossBattle(current.battleId)).toBe(false);
    expect(engine.getState()).toEqual(settled);
    expect(engine.getState().ledger.history).toHaveLength(1);
    expect(engine.getState().realm).toBe('练气一层');
  });

  it('finalizes defeat once and accepts retry only after registering a new battle ID', () => {
    const engine = atBossGate();
    const defeated = registerBossSummary(engine, summary('battle-defeated', 'defeat'));
    expect(engine.reportBossDefeat({ ...defeated, result: 'victory' }, 100)).toBe(false);
    expect(engine.reportBossDefeat(defeated, 101)).toBe(true);
    const afterDefeat = structuredClone(engine.getState());
    expect(engine.reportBossDefeat(defeated, 102)).toBe(false);
    expect(engine.reportBossVictory({ ...defeated, result: 'victory' }, 102)).toBe(false);
    expect(engine.registerBossBattle(defeated.battleId)).toBe(false);
    const retry = { ...defeated, battleId: 'battle-retry', result: 'victory' as const };
    expect(engine.reportBossVictory(retry, 103)).toBe(false);
    expect(engine.getState()).toEqual(afterDefeat);
    expect(engine.getState().phase).toBe('BOSS_GATE');
    expect(engine.getState().ledger.history).toHaveLength(0);
    expect(engine.registerBossBattle(retry.battleId)).toBe(true);
    expect(engine.reportBossDefeat(defeated, 104)).toBe(false);
    expect(engine.reportBossVictory(retry, 105)).toBe(true);
    expect(engine.getState().lastBattleSummary!.battleId).toBe(retry.battleId);
    expect(engine.getState().ledger.history).toHaveLength(1);
  });
});

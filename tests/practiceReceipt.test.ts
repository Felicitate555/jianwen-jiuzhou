import { expect, it } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';
import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';

it('only a new current learning receipt may increment mastery, even when two successes required', () => {
  const le = new LifeEngine();
  le.selectGender('male', 0); le.generateIdentity(1);
  le.settleNarrative(le.eventIdentity()!.requestId, 2); le.confirmProfile(3);
  le.completeSensing(4); le.reportTrialResult(true, 5); le.beginFirstChoice(6);
  le.settleNarrative(le.eventIdentity()!.requestId, 7); le.selectOption('intent-steady', 8);
  le.confirmChoiceStroke(800, 100, 'ACTIVE', 9); finishChoiceNarrative(le);
  le.settleNarrative(le.eventIdentity()!.requestId, 11); le.respondCompanion('skip', 12);
  le.settleNarrative(le.eventIdentity()!.requestId, 13); le.selectOption('fate-sect', 14);
  le.confirmChoiceStroke(800, 100, 'ACTIVE', 15); finishChoiceNarrative(le);
  const kind = le.currentTechniqueKind()!;
  le.settleNarrative(le.eventIdentity()!.requestId, 17);
  const ev = le.eventIdentity()!;
  const receipt = { kind, eventInstanceId: ev.eventInstanceId, requestId: ev.requestId, learningInstanceId: 'learning-test', segmentId: 1, createdAt: 20, startedAt: 18 };
  expect(le.acceptPracticeReceipt(receipt, 20)).toBeNull();
  le.acknowledgeTechniqueManual(kind, 18); le.beginTechniquePractice(kind, 19);
  Object.assign(receipt, le.getPracticeSession(19));
  le.getState().techniques.requiredSuccesses[kind] = 2;
  expect(le.acceptPracticeReceipt({ ...receipt, eventInstanceId: 'stale' }, 20)).toBeNull();
  expect(le.acceptPracticeReceipt({ ...receipt, createdAt: 17 }, 20)).toBeNull();
  expect(le.acceptPracticeReceipt(receipt, 20)).toBe('counting');
  expect(le.acceptPracticeReceipt(receipt, 21)).toBeNull();
  expect(le.acceptPracticeReceipt({ ...receipt, segmentId: 2, createdAt: 22 }, 22)).toBe('mastered');
  expect(le.getState().techniques.learned).toContain(kind);
});

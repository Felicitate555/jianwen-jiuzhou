import { expect, it } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';

it('a committed choice waits for its own narrative and an explicit continue', () => {
  const life = new LifeEngine();
  life.selectGender('female', 0); life.generateIdentity(1);
  life.settleNarrative(life.eventIdentity()!.requestId, 2); life.confirmProfile(3);
  life.completeSensing(4); life.reportTrialResult(true, 5); life.beginFirstChoice(6);
  life.settleNarrative(life.eventIdentity()!.requestId, 7);
  life.selectOption('intent-steady', 8);
  const previous = life.eventIdentity()!;
  expect(life.confirmChoiceStroke(800, 100, 'ACTIVE', 9)).toBe(true);
  expect(life.getState().phase).toBe('FATE_CHOICE_INTENT');
  expect(life.getState().activeEvent?.phase).toBe('NARRATIVE_PENDING');
  expect(life.getState().activeEvent?.chosenOptionId).toBe('intent-steady');
  expect(life.eventIdentity()!.eventInstanceId).not.toBe(previous.eventInstanceId);
  expect(life.selectOption('intent-swift', 10)).toBe(false);
  expect(life.continueChoiceNarrative(10)).toBe(false);
  expect(life.settleNarrative(previous.requestId, 11)).toBe(false);
  life.settleNarrative(life.eventIdentity()!.requestId, 12);
  expect(life.getState().activeEvent?.phase).toBe('NARRATIVE_READY');
  expect(life.continueChoiceNarrative(13)).toBe(true);
  expect(life.getState().phase).toBe('COMPANION_EVENT');
  expect(life.continueChoiceNarrative(14)).toBe(false);
});

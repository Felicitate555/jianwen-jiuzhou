import { expect } from 'vitest';
import type { LifeEngine } from '@/life/lifeEngine';

/** Complete the committed choice consequence before setting up later chapter events. */
export function finishChoiceNarrative(engine: LifeEngine): void {
  const state = engine.getState();
  expect(['FATE_CHOICE_INTENT', 'FATE_CHOICE_FATE']).toContain(state.phase);
  expect(state.activeEvent?.chosenOptionId).toBeTruthy();
  expect(state.activeEvent?.phase).toBe('NARRATIVE_PENDING');
  expect(engine.settleNarrative(state.activeEvent!.requestId, state.updatedAt)).toBe(true);
  expect(engine.getState().activeEvent?.phase).toBe('NARRATIVE_READY');
  expect(engine.continueChoiceNarrative(state.updatedAt)).toBe(true);
}

import { expect } from 'vitest';
import type { BattleSummary } from '@/combat/combatEngine';
import type { LifeEngine } from '@/life/lifeEngine';

/** Mirror App's battle registration and transport identity for a positive fixture. */
export function registerBossSummary(engine: LifeEngine, summary: BattleSummary): BattleSummary {
  expect(engine.registerBossBattle(summary.battleId)).toBe(true);
  const { lifeId, chapterInstanceId } = engine.getState();
  return { ...summary, lifeId, chapterInstanceId };
}

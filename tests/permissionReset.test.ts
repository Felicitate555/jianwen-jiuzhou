import { expect, it } from 'vitest';
import { CombatEngine } from '@/combat/combatEngine';

it('battle retries retain permissions but authoritative replacement clears a replay/new life', () => {
  const combat = new CombatEngine();
  combat.replaceLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true });
  combat.start(0); combat.startBoss(1);
  expect(combat.getSnapshot().technique.learned.cross).toBe(true);
  combat.reset(2);
  combat.replaceLearnedTechniques({ diagonalSlash: false, cross: false, returnWind: false });
  combat.start(3);
  expect(combat.getSnapshot().technique.learned).toEqual({ diagonalSlash: false, cross: false, returnWind: false });
});

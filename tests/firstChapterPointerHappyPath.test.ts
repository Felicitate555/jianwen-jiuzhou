// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { PointerInput } from '@/input/pointerInput';
import { SwordEngine } from '@/engine/swordEngine';
import { CombatEngine } from '@/combat/combatEngine';
import { DEFAULT_COMBAT_CONFIG } from '@/combat/combatConfig';
import { LifeEngine } from '@/life/lifeEngine';
import { requestNarrative, type NarrativeKind } from '@/life/aiNarrative';
import { CompetentBossPolicy } from './helpers/competentBossPolicy';
import type { InputFrame } from '@/lib/types';

vi.mock('@/db/supabase', () => ({ supabase: null }));

const W = 800;
const H = 600;

it('Pointer 从新人生走完第一章并抵达 JOURNEY_GATE', async () => {
  const life = new LifeEngine();
  const sword = new SwordEngine();
  const combat = new CombatEngine({
    ...DEFAULT_COMBAT_CONFIG,
    wolf: { ...DEFAULT_COMBAT_CONFIG.wolf, hpMax: 1 },
    ranged: { ...DEFAULT_COMBAT_CONFIG.ranged, spawnDelayMs: 20, chargeWindupMs: 20, chargeMs: 80, recoverMs: 20, maxCycles: 1, dyingMs: 20 },
    projectile: { ...DEFAULT_COMBAT_CONFIG.projectile, speedRatio: 0.01, lifeMs: 80 },
  });
  const stage = document.createElement('div');
  Object.defineProperty(stage, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON() {} }) });
  stage.setPointerCapture = vi.fn();
  stage.releasePointerCapture = vi.fn();
  stage.hasPointerCapture = () => true;
  document.body.replaceChildren(stage);

  let intendedAt = 0;
  let pointerDown = false;
  let choicePath = 0;
  let lastChoice: { x: number; y: number } | null = null;
  const adapter = new PointerInput((incoming) => {
    const frame = { ...incoming, timestamp: intendedAt };
    sword.pushFrame(frame);
    const phase = life.getState().phase;
    if (phase === 'FATE_CHOICE_INTENT' || phase === 'FATE_CHOICE_FATE') {
      if (frame.actionState === 'ACTIVE') {
        if (lastChoice) choicePath += Math.hypot(frame.x - lastChoice.x, frame.y - lastChoice.y);
        lastChoice = frame;
        if (life.getState().pendingChoiceId && choicePath >= 80) life.confirmChoiceStroke(W, choicePath, 'ACTIVE', intendedAt);
      } else { choicePath = 0; lastChoice = null; }
      return;
    }
    combat.onFrame(frame, sword.lastSmoothedPoint);
  }, () => stage);
  adapter.start();

  const emit = (frame: InputFrame) => {
    intendedAt = frame.timestamp;
    let type = 'pointermove';
    if (frame.actionState === 'ACTIVE' && !pointerDown) { type = 'pointerdown'; pointerDown = true; }
    else if (frame.actionState !== 'ACTIVE' && pointerDown) { type = 'pointerup'; pointerDown = false; }
    else if (frame.actionState !== 'ACTIVE') return;
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: frame.x, clientY: frame.y });
    stage.dispatchEvent(event);
  };
  const release = (at: number) => emit({ x: W / 2, y: H / 2, timestamp: at, actionState: 'SHEATHED', source: 'pointer' });
  const settle = async (kind: NarrativeKind) => {
    const result = await requestNarrative(life.getState(), kind);
    expect(result.requestId).toBe(life.eventIdentity()?.requestId);
    expect(life.settleNarrative(result.requestId!, intendedAt += 10)).toBe(true);
  };
  const stroke = (x0: number, y0: number, x1: number, y1: number, start: number, duration = 320) => {
    for (let i = 0; i <= 14; i++) {
      const at = start + duration * i / 14;
      emit({ x: x0 + (x1 - x0) * i / 14, y: y0 + (y1 - y0) * i / 14, timestamp: at, actionState: 'ACTIVE', source: 'pointer' });
      combat.update(at, W, H);
    }
    release(start + duration + 1);
  };

  expect(life.selectGender('female', 1)).toBe(true);
  expect(life.generateIdentity(2)).toBe(true);
  await settle({ kind: 'identity' });
  expect(life.confirmProfile(intendedAt += 10)).toBe(true);

  for (let i = 0; i <= 50; i++) emit({ x: 100 + (i % 10) * 45, y: 180 + (i % 2) * 120, timestamp: 100 + i * 50, actionState: 'ACTIVE', source: 'pointer' });
  release(2610);
  expect(sword.success).toBe(true);
  expect(life.completeSensing(2620)).toBe(true);

  combat.start(2630);
  let now = 2630;
  for (let tries = 0; tries < 8 && combat.getSnapshot().wolf.state !== 'DEAD'; tries++) {
    const pos = combat.wolfScreenPos(W, H);
    stroke(pos.x - 150, pos.y, pos.x + 150, pos.y, now += 400, 220);
    combat.update(now += 250, W, H);
  }
  while (combat.currentPhase === 'fighting' && now < 20_000) {
    release(now += 100);
    combat.update(now, W, H);
  }
  const rhythm = (combat as unknown as { bossRhythm: unknown }).bossRhythm;
  expect(combat.currentPhase, JSON.stringify({ rhythm, snapshot: combat.getSnapshot() })).toBe('won');
  expect(life.reportTrialResult(true, now)).toBe(true);
  expect(life.beginFirstChoice(now += 10)).toBe(true);

  await settle({ kind: 'choice', stage: 'intent' });
  expect(life.selectOption('intent-steady', now += 10)).toBe(true);
  stroke(120, 420, 300, 420, now += 10);
  expect(life.getState().activeEvent?.chosenOptionId).toBe('intent-steady');
  await settle({ kind: 'choice', stage: 'intent' });
  expect(life.continueChoiceNarrative(now += 10)).toBe(true);
  await settle({ kind: 'companion' });
  expect(life.respondCompanion('warm', now += 10)).toBe(true);
  await settle({ kind: 'choice', stage: 'fate' });
  expect(life.selectOption('fate-sect', now += 10)).toBe(true);
  stroke(120, 420, 300, 420, now += 10);
  await settle({ kind: 'choice', stage: 'fate' });
  expect(life.continueChoiceNarrative(now += 10)).toBe(true);

  for (let learned = 0; learned < 3; learned++) {
    const kind = life.currentTechniqueKind()!;
    await settle({ kind: 'technique', techniqueKind: kind });
    expect(life.acknowledgeTechniqueManual(kind, now += 10)).toBe(true);
    expect(life.beginTechniquePractice(kind, now += 10)).toBe(true);
    const session = life.getPracticeSession(now)!;
    combat.setPracticeContext({ ...session, kind: kind === 'diagonalSlash' ? 'DIAGONAL_SLASH' : kind === 'cross' ? 'CROSS' : 'RETURN_WIND' });
    const start = now += 20;
    if (kind === 'diagonalSlash') stroke(200, 160, 520, 410, start, 300);
    else if (kind === 'cross') {
      stroke(210, 170, 510, 420, start, 300);
      stroke(210, 420, 510, 170, start + 430, 300);
    } else {
      for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 2; emit({ x: 400 + Math.cos(a) * 140, y: 300 + Math.sin(a) * 140, timestamp: start + i * 16, actionState: 'ACTIVE', source: 'pointer' }); combat.update(start + i * 16, W, H); }
      release(start + 961);
    }
    combat.update(intendedAt, W, H);
    const receipt = combat.getPracticeReceipt();
    expect(receipt?.kind).toBe(kind === 'diagonalSlash' ? 'DIAGONAL_SLASH' : kind === 'cross' ? 'CROSS' : 'RETURN_WIND');
    expect(life.acceptPracticeReceipt({ ...receipt!, kind }, intendedAt)).toBe('mastered');
    now = intendedAt + 20;
  }
  expect(life.getState().techniques.learned).toHaveLength(3);
  expect(life.getState().phase).toBe('BOSS_GATE');

  const state = life.getState();
  const bossCombat = new CombatEngine();
  bossCombat.replaceLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true });
  bossCombat.startBoss(now, { lifeId: state.lifeId, chapterInstanceId: state.chapterInstanceId });
  expect(life.registerBossBattle(bossCombat.activeBattleId!)).toBe(true);
  const policy = new CompetentBossPolicy();
  for (now += 16; now < 400_000 && bossCombat.currentPhase === 'fighting'; now += 16) {
    const frame = policy.next(bossCombat.getSnapshot(), now, W, H);
    bossCombat.onFrame(frame, null);
    bossCombat.update(now, W, H);
  }
  expect(bossCombat.currentPhase).toBe('won');
  const summary = bossCombat.getBattleSummary()!;
  expect(summary.result).toBe('victory');
  expect(life.reportBossVictory(summary, now)).toBe(true);
  await settle({ kind: 'archetype' });
  expect(life.enterJourney(now += 10)).toBe(true);
  expect(life.getState()).toMatchObject({ phase: 'JOURNEY_GATE', realm: '练气一层' });
  expect(life.getState().ledger.history).toHaveLength(1);
  adapter.stop();
});

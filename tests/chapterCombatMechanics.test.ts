import { describe, expect, it } from 'vitest';
import { CombatEngine } from '@/combat/combatEngine';
import type { InputFrame } from '@/lib/types';
import { CompetentBossPolicy } from './helpers/competentBossPolicy';

const W = 800, H = 600;
const feed = (e: CombatEngine, x: number, y: number, timestamp: number, actionState: InputFrame['actionState'] = 'ACTIVE') => {
  e.onFrame({ x, y, timestamp, actionState, source: 'pointer' }, null); e.update(timestamp, W, H);
};

describe('chapter combat contracts through incremental input', () => {
  it('geometry practice works while idle and choice-gated without combat or authority effects', () => {
    const e = new CombatEngine(); e.enterChoiceMode(0);
    const ctx = { kind: 'RETURN_WIND' as const, eventInstanceId: 'e', requestId: 'r', learningInstanceId: 'l', startedAt: 100 };
    e.setPracticeContext(ctx);
    const before = e.getSnapshot();
    for (let i=0; i<=60; i++) { const a=i/60*Math.PI*2; feed(e,400+140*Math.cos(a),300+140*Math.sin(a),100+i*16); }
    const receipt = e.getPracticeReceipt()!;
    expect(receipt).toMatchObject({ ...ctx, createdAt: expect.any(Number), segmentId: expect.any(Number) });
    expect(e.getSnapshot()).toMatchObject({ phase: 'idle', qi: before.qi, guardQi: before.guardQi, techniqueFx: [], technique: { learned: { diagonalSlash:false, cross:false, returnWind:false } } });
    e.setPracticeContext(ctx); expect(e.getPracticeReceipt()).toEqual(receipt);
    e.setPracticeContext({ ...ctx, learningInstanceId:'next', startedAt:1100 });
    e.update(1100,W,H); expect(e.getPracticeReceipt()).toBeNull();
  });
  it('default boss cannot be passed by horizontal attacks without successful mechanics', () => {
    const e = new CombatEngine(); e.startBoss(0);
    for(let t=16;t<65000 && e.currentPhase==='fighting';t+=16) {
      const b=e.getSnapshot().boss!;
      const cycle=t%600;
      feed(e,b.x*W+(cycle/600-.5)*360,b.y*H,t,cycle>560?'IDLE':'ACTIVE');
    }
    expect(e.currentPhase).not.toBe('won');
    expect(e.getSnapshot().boss!.phase).toBe('TRIAL_SWORD');
    expect(e.getBattleSummary()?.result).toBe('defeat');
  });
  it('public snapshot policy wins all three default phases with real actions and an accurate immutable summary', () => {
    const e = new CombatEngine();
    e.replaceLearnedTechniques({ diagonalSlash:true, cross:true, returnWind:true });
    e.startBoss(0,{lifeId:'life',chapterInstanceId:'chapter'});
    const policy = new CompetentBossPolicy(); const phases = new Set<string>();
    for(let t=16;t<180000 && e.currentPhase==='fighting';t+=16) {
      const s=e.getSnapshot(); phases.add(s.boss!.phase);
      const f=policy.next(s,t,W,H); e.onFrame(f,null); e.update(t,W,H);
    }
    const summary=e.getBattleSummary();
    expect({phase:e.currentPhase, summary, snapshot:e.getSnapshot()}).toMatchObject({phase:'won'});
    expect([...phases]).toEqual(['TRIAL_SWORD','BREAK_STANCE','CHAOS']);
    expect(summary).toMatchObject({ lifeId:'life',chapterInstanceId:'chapter',result:'victory' });
    expect(summary!.blocks).toBeGreaterThan(0); expect(summary!.interrupts).toBeGreaterThan(0); expect(summary!.projectilesCut).toBeGreaterThan(0);
    expect(summary!.averageSpeed).toBeGreaterThan(0); expect(summary!.averageSpeed).toBeLessThan(3.2);
    expect(summary!.techniqueUsage.some(v=>v.kind==='returnWind')).toBe(true);
    const copy=JSON.stringify(summary); e.update(200000,W,H); expect(JSON.stringify(e.getBattleSummary())).toBe(copy);
    expect(Object.isFrozen(summary)).toBe(true);
    const id=e.activeBattleId; e.startBoss(210000,{lifeId:'life',chapterInstanceId:'chapter'}); expect(e.activeBattleId).not.toBe(id); expect(e.getBattleSummary()).toBeNull();
  });
});

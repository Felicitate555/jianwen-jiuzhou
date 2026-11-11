import type { CombatSnapshot } from '@/combat/combatEngine';
import type { InputFrame } from '@/lib/types';

/** Deterministic player policy. Reads only public render state and emits ordinary pointer frames. */
export class CompetentBossPolicy {
  private stroke: { x: number; y: number; start: number; wind: boolean; projectile?: boolean } | null = null;
  private releaseUntil = 0;
  private blockedTrial = false;
  private cutChaos = false;
  next(s: CombatSnapshot, now: number, w: number, h: number): InputFrame {
    const frame = (x: number, y: number, actionState: InputFrame['actionState']): InputFrame => ({ x, y, timestamp: now, actionState, source: 'pointer' });
    const b = s.boss;
    if (!b) return frame(w / 2, h / 2, 'SHEATHED');
    if (s.projectileFx.some(p => p.slashed) && b.phase === 'CHAOS') this.cutChaos = true;
    if (b.phase === 'TRIAL_SWORD' && b.melee.lungeResolved) this.blockedTrial = true;
    if (b.melee.state === 'TELEGRAPH' || b.melee.state === 'LUNGE') {
      this.stroke = null;
      return frame(w / 2, h / 2, 'SHEATHED');
    }
    if (now < this.releaseUntil) return frame(w / 2, h / 2, 'SHEATHED');
    if (this.stroke) {
      const st = this.stroke;
      const duration = st.wind ? 650 : 360;
      const t = Math.min(1, (now - st.start) / duration);
      if (t >= 1) { this.stroke = null; this.releaseUntil = now + 200; return frame(w / 2, h / 2, 'SHEATHED'); }
      if (st.wind) return frame(st.x + Math.cos(t * Math.PI * 2) * w * 0.2, st.y + Math.sin(t * Math.PI * 2) * w * 0.2, 'ACTIVE');
      if (st.projectile) return frame(st.x + (t - 0.5) * w * 0.9, st.y, 'ACTIVE');
      return frame(st.x + (t - 0.5) * w * 0.36, st.y + (t - 0.5) * w * 0.28, 'ACTIVE');
    }
    const projectile = s.projectiles[0];
    if (projectile && s.qi > 8) {
      this.stroke = {
        x: w / 2,
        y: (projectile.y + projectile.vy * 0.15) * h,
        start: now,
        wind: false,
        projectile: true,
      };
    } else if (s.qi < 55 || (b.phase === 'TRIAL_SWORD' && !this.blockedTrial) || b.x > 0.98) {
      return frame(w / 2, h / 2, 'SHEATHED');
    } else if (b.phase === 'CHAOS' && s.adds.some(a => a.state !== 'DEAD' && a.state !== 'DYING')) {
      const add = s.adds.find(a => a.state !== 'DEAD' && a.state !== 'DYING')!;
      this.stroke = { x: (add.x + add.knockback) * w, y: add.y * h, start: now, wind: true };
    } else if (b.phase === 'CHAOS' && !this.cutChaos) {
      return frame(w / 2, h / 2, 'SHEATHED');
    } else if (b.phase === 'BREAK_STANCE' && !s.bossGeometry?.weakPoint.active && b.ranged.state !== 'INTERRUPTED') {
      return frame(w / 2, h / 2, 'SHEATHED');
    } else this.stroke = { x: b.x * w, y: b.y * h, start: now, wind: false };
    return this.next(s, now, w, h);
  }
}

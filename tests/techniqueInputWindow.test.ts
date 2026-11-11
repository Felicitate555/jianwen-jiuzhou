import { describe, expect, it } from 'vitest';
import { SlashDetector } from '@/combat/slashDetect';
import type { InputFrame } from '@/lib/types';
import { TechniqueEngine } from '@/technique/techniqueEngine';
import { TechniqueInputWindow } from '@/technique/techniqueInputWindow';

const W = 800;
const frame = (x: number, y: number, timestamp: number, actionState: InputFrame['actionState'] = 'ACTIVE'): InputFrame =>
  ({ x, y, timestamp, actionState, source: 'pointer' });

describe('TechniqueInputWindow independent incremental recognition', () => {
  it.each([16, 40])('retains both cross strokes after combat consumes and closes the first (%ims frames)', (dt) => {
    const window = new TechniqueInputWindow();
    const engine = new TechniqueEngine();
    const combat = new SlashDetector({ minPathPx: 64, minAvgSpeedPxPerSec: 0, segmentWindowMs: 600, segmentIdleCloseMs: 250 });
    const kinds: string[] = [];
    let consumed = false;
    const draw = (reverse: boolean, start: number) => {
      for (let i = 0; i <= 12; i++) {
        const t = start + i * dt;
        const x = 200 + i * 25;
        const y = reverse ? 430 - i * 20 : 190 + i * 20;
        window.feed(frame(x, y, t), null);
        combat.feed({ x, y, t }, true, t);
        if (!consumed && combat.tryStrike()) {
          consumed = true;
          combat.markConsumed();
          combat.closeSegment();
        }
        const result = window.sample(engine, W, t);
        if (result) kinds.push(result.kind);
      }
    };
    draw(false, 100);
    window.feed(frame(500, 430, 100 + 12 * dt + 1, 'SHEATHED'), null);
    draw(true, 100 + 12 * dt + 160);
    expect(consumed).toBe(true);
    expect(kinds).toContain('DIAGONAL_SLASH');
    expect(kinds.filter((kind) => kind === 'CROSS')).toHaveLength(1);
    expect(window.startedAt).toBe(100);
  });

  it.each([16, 40])('recognizes a wind incrementally beyond the ordinary combat window (%ims frames)', (dt) => {
    const window = new TechniqueInputWindow();
    const engine = new TechniqueEngine();
    const results = [];
    const count = Math.floor(1120 / dt);
    for (let i = 0; i <= count; i++) {
      const a = (i / count) * Math.PI * 2;
      const t = 100 + i * dt;
      window.feed(frame(400 + Math.cos(a) * 140, 300 + Math.sin(a) * 140, t), null);
      const result = window.sample(engine, W, t, 'RETURN_WIND');
      if (result) results.push(result);
    }
    expect(results.map((result) => result.kind)).toEqual(['RETURN_WIND']);
    expect(window.currentSegment!.points[0].t).toBe(100);
    expect(window.currentSegment!.durationMs).toBeGreaterThan(600);
    expect(window.sample(engine, W, 1230, 'RETURN_WIND')).toBeNull();
  });

  it('samples the closed stroke on release, deduplicates, and uses new IDs after reset', () => {
    const window = new TechniqueInputWindow();
    const engine = new TechniqueEngine();
    const draw = (start: number) => {
      for (let i = 0; i <= 10; i++) window.feed(frame(200 + 25 * i, 150 + 20 * i, start + 16 * i), null);
      window.feed(frame(450, 350, start + 161, 'SHEATHED'), null);
      return window.sample(engine, W, start + 162, 'DIAGONAL_SLASH');
    };
    const first = draw(100)!;
    expect(first.kind).toBe('DIAGONAL_SLASH');
    expect(window.sample(engine, W, 280, 'DIAGONAL_SLASH')).toBeNull();
    window.reset();
    expect(window.currentSegment).toBeNull();
    expect(window.sample(engine, W, 300)).toBeNull();
    expect(draw(400)!.segmentId).not.toBe(first.segmentId);
  });

  it('uses a true 550ms gap between strokes and rejects stale pairing', () => {
    for (const gap of [550, 551]) {
      const window = new TechniqueInputWindow();
      const engine = new TechniqueEngine();
      for (let i = 0; i <= 10; i++) window.feed(frame(200 + 30 * i, 190 + 24 * i, 100 + i * 40), null);
      window.feed(frame(500, 430, 501, 'SHEATHED'), null);
      for (let i = 0; i <= 10; i++) window.feed(frame(200 + 30 * i, 430 - 24 * i, 500 + gap + i * 40), null);
      expect(window.sample(engine, W, 900 + gap, 'CROSS')?.kind ?? null).toBe(gap === 550 ? 'CROSS' : null);
    }
  });

  it('practice filters competing shapes and ignores cooldown without mutating formal cooldown', () => {
    const window = new TechniqueInputWindow();
    const engine = new TechniqueEngine();
    const draw = (start: number) => {
      for (let i = 0; i <= 10; i++) window.feed(frame(200 + 25 * i, 150 + 20 * i, start + 16 * i), null);
    };
    draw(100);
    expect(window.sample(engine, W, 260, 'CROSS')).toBeNull();
    const first = window.sample(engine, W, 260)!;
    engine.commit(first, 260);
    window.reset();
    draw(300);
    expect(window.sample(engine, W, 460)).toBeNull();
    expect(window.sample(engine, W, 460, 'DIAGONAL_SLASH')?.kind).toBe('DIAGONAL_SLASH');
    expect(engine.classify(window.currentSegment!, [], W, 460).kind).toBe('NONE');
  });

  it('bounds high-frequency input and resets when the input source changes', () => {
    const window = new TechniqueInputWindow();
    const engine = new TechniqueEngine();
    for (let i = 0; i < 10000; i++) window.feed(frame(200 + i / 20, 150 + i / 25, 100 + i / 10), null);
    expect(window.sample(engine, W, 1100, 'DIAGONAL_SLASH')?.kind).toBe('DIAGONAL_SLASH');
    expect(window.currentSegment!.points.length).toBeLessThanOrEqual(160);
    window.feed({ ...frame(600, 500, 1120), source: 'camera' }, null);
    expect(window.sample(engine, W, 1120)).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { FlyingSword } from '@/render/flyingSword';

function makeContext() {
  return {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), quadraticCurveTo: vi.fn(),
    set globalAlpha(_value: number) {}, set fillStyle(_value: string | CanvasGradient) {},
    set strokeStyle(_value: string) {}, set lineWidth(_value: number) {},
    set shadowColor(_value: string) {}, set shadowBlur(_value: number) {},
  } as unknown as CanvasRenderingContext2D;
}

describe('FlyingSword', () => {
  it('uses inertial follow instead of snapping away from the sword tip', () => {
    const sword = new FlyingSword();
    const ctx = makeContext();
    sword.update({ x: 0, y: 0 }, 0, 16);
    sword.update({ x: 100, y: 0 }, 16, 16);
    sword.draw(ctx, 16, 1);
    expect(ctx.translate).toHaveBeenCalledWith(32, expect.any(Number));
  });

  it('fades out after the sword tip disappears', () => {
    const sword = new FlyingSword();
    const ctx = makeContext();
    sword.update({ x: 20, y: 30 }, 0, 160);
    sword.update(null, 320, 320);
    sword.draw(ctx, 320, 1);
    expect(ctx.translate).not.toHaveBeenCalled();
  });
});

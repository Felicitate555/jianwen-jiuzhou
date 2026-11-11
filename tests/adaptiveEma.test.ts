import { describe, expect, it } from 'vitest';
import { AdaptiveEma, DEFAULT_EMA_CONFIG } from '@/engine/adaptiveEma';

describe('低延迟自适应 EMA（第一轮手感校准参数）', () => {
  it('默认参数为校准值：alphaSlow=0.44、alphaFast=0.84、speedScalePx=34', () => {
    expect(DEFAULT_EMA_CONFIG).toEqual({
      alphaSlow: 0.44,
      alphaFast: 0.84,
      speedScalePx: 34,
    });
  });

  it('首帧直接落点，不做平滑', () => {
    const ema = new AdaptiveEma();
    expect(ema.update(100, 200)).toEqual({ x: 100, y: 200 });
  });

  it('慢速移动（alpha≈0.44）抑制抖动且少落后', () => {
    const ema = new AdaptiveEma();
    ema.update(0, 0);
    // 1px 抖动：alpha ≈ 0.44 + 0.4/34 ≈ 0.452，输出远小于位移
    const out = ema.update(1, 0);
    expect(out.x).toBeGreaterThan(0.4);
    expect(out.x).toBeLessThan(0.5);
  });

  it('中速（≈speedScalePx=34px）即进入高 alpha 0.84', () => {
    const ema = new AdaptiveEma();
    ema.update(0, 0);
    const out = ema.update(34, 0); // t = 1 → alpha = 0.84
    expect(out.x).toBeCloseTo(34 * 0.84, 1);
  });

  it('快速移动 alpha≈0.84，反向更快追上 raw 点', () => {
    const ema = new AdaptiveEma();
    ema.update(0, 0);
    const out = ema.update(200, 0); // 远超 speedScalePx
    expect(out.x).toBeCloseTo(168, 1); // ≈0.84 * 200
  });

  it('reset 后下一帧直接落点（丢失手/收势重置）', () => {
    const ema = new AdaptiveEma();
    ema.update(0, 0);
    ema.update(50, 0);
    ema.reset();
    expect(ema.hasPrev).toBe(false);
    expect(ema.update(300, 300)).toEqual({ x: 300, y: 300 });
  });

  it('连续平滑收敛于目标且延迟有界', () => {
    const ema = new AdaptiveEma();
    ema.update(0, 0);
    let cur = 0;
    for (let i = 0; i < 10; i++) {
      cur = ema.update(100, 0).x;
    }
    expect(cur).toBeGreaterThan(90);
  });
});
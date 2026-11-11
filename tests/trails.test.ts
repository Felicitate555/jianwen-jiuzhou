import { describe, expect, it } from 'vitest';
import { SwordEngine } from '@/engine/swordEngine';
import type { EngineConfig, InputFrame } from '@/lib/types';

const CFG: EngineConfig = {
  jitterThresholdPx: 8,
  targetEffectiveMs: 2000,
  trailTtlMs: 60_000,
  maxSampleGapMs: 400,
};

function frame(x: number, y: number, t: number, actionState: InputFrame['actionState'] = 'ACTIVE'): InputFrame {
  return { x, y, timestamp: t, actionState, source: 'camera' };
}

describe('rawTrail 与 smoothedTrail 双缓冲独立性', () => {
  it('raw 坐标严格等于镜像映射后的原始输入，非平滑结果', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(100, 0, 40));
    // EMA(alpha≈0.35~0.75) 会把平滑点拉向 0，raw 必须保持 100
    expect(e.rawTrail[1].x).toBe(100);
    expect(e.smoothedTrail[1].x).toBeLessThan(100);
    expect(e.smoothedTrail[1].x).toBeGreaterThan(0);
  });

  it('raw 在 EMA 之前入缓冲：rawTrail 长度始终不小于 smoothedTrail', () => {
    const e = new SwordEngine(CFG);
    for (let i = 0; i < 20; i++) {
      e.pushFrame(frame(i * 10, 0, i * 40));
    }
    expect(e.rawTrail.length).toBe(20);
    expect(e.smoothedTrail.length).toBe(20);
    expect(e.rawTrail[19]).toEqual({ x: 190, y: 0, t: 760, a: 'ACTIVE' });
  });

  it('SHEATHED 帧：raw 记录坐标但 smoothed 不追加（收势停止绘制）', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(50, 0, 40));
    e.pushFrame(frame(60, 0, 80, 'SHEATHED'));
    expect(e.rawTrail.length).toBe(3);
    expect(e.smoothedTrail.length).toBe(2);
    expect(e.rawTrail[2].a).toBe('SHEATHED');
  });

  it('IDLE（丢手）帧不写任何轨迹，且平滑状态重置', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(50, 0, 40));
    e.pushFrame(frame(-1, -1, 80, 'IDLE'));
    expect(e.rawTrail.length).toBe(2);
    expect(e.smoothedTrail.length).toBe(2);
    // IDLE 后恢复：EMA 已重置，平滑点直接落点
    e.pushFrame(frame(500, 500, 200));
    expect(e.smoothedTrail[2].x).toBe(500);
  });

  it('两条轨迹带时间戳且逐点可对照（肉眼确认抖动差异）', () => {
    const e = new SwordEngine(CFG);
    const xs = [100, 112, 95, 120, 90];
    xs.forEach((x, i) => e.pushFrame(frame(x, 50, i * 40)));
    // raw 含全部抖动极值；smooth 不含（被 EMA 拉平）
    expect(e.rawTrail.map((p) => p.x)).toEqual(xs);
    const smoothXs = e.smoothedTrail.map((p) => p.x);
    expect(Math.max(...smoothXs) - Math.min(...smoothXs)).toBeLessThan(
      Math.max(...xs) - Math.min(...xs),
    );
  });
});
import { describe, expect, it } from 'vitest';
import { SwordEngine } from '@/engine/swordEngine';
import type { EngineConfig, InputFrame } from '@/lib/types';

const CFG: EngineConfig = {
  jitterThresholdPx: 8,
  targetEffectiveMs: 2000,
  trailTtlMs: 60_000,
  maxSampleGapMs: 400,
};

function frame(
  x: number,
  y: number,
  t: number,
  actionState: InputFrame['actionState'] = 'ACTIVE',
  source: InputFrame['source'] = 'camera',
): InputFrame {
  return { x, y, timestamp: t, actionState, source };
}

describe('有效移动累计与成功判定', () => {
  it('ACTIVE 且位移超过抖动阈值时按间隔累计有效时间', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(20, 0, 100)); // 位移 20 > 8
    e.pushFrame(frame(40, 0, 200));
    expect(e.effectiveMs).toBe(200);
  });

  it('静止（位移低于阈值）不累计', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(3, 0, 500)); // 抖动，不计
    e.pushFrame(frame(5, 0, 1000));
    expect(e.effectiveMs).toBe(0);
  });

  it('SHEATHED / IDLE 只暂停累计，不清零', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(20, 0, 100));
    expect(e.effectiveMs).toBe(100);
    e.pushFrame(frame(20, 0, 300, 'SHEATHED'));
    e.pushFrame(frame(20, 0, 600, 'IDLE'));
    expect(e.effectiveMs).toBe(100);
    // 恢复 ACTIVE 首帧仅重建参考点，不虚增
    e.pushFrame(frame(25, 0, 900));
    expect(e.effectiveMs).toBe(100);
    e.pushFrame(frame(50, 0, 1000));
    expect(e.effectiveMs).toBe(200);
  });

  it('静止等待 2 秒不会成功——只有有效移动才累计', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    for (let t = 40; t <= 3000; t += 40) {
      e.pushFrame(frame(1, 1, t)); // 微抖，低于阈值
    }
    expect(e.effectiveMs).toBe(0);
    expect(e.success).toBe(false);
  });

  it('累计达到 2 秒判定成功，且不超过上限', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    let t = 0;
    while (!e.success) {
      t += 40;
      e.pushFrame(frame(t, 0, t));
    }
    expect(e.effectiveMs).toBeGreaterThanOrEqual(2000);
    expect(e.effectiveMs).toBeLessThanOrEqual(2040);
    expect(e.success).toBe(true);
  });

  it('样本间隔过长（丢帧）不累计虚假时间', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(50, 0, 1000)); // gap 1000 > 400
    expect(e.effectiveMs).toBe(0);
  });

  it('切换输入模式 resetAll 清零累计与轨迹；resetProgress 仅清累计', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0));
    e.pushFrame(frame(20, 0, 100));
    e.resetProgress();
    expect(e.effectiveMs).toBe(0);
    expect(e.rawTrail.length).toBe(2);
    e.resetAll();
    expect(e.rawTrail.length).toBe(0);
    expect(e.smoothedTrail.length).toBe(0);
  });

  it('Pointer 与 Camera 帧走同一累计逻辑（无来源分叉）', () => {
    const e = new SwordEngine(CFG);
    e.pushFrame(frame(0, 0, 0, 'ACTIVE', 'pointer'));
    e.pushFrame(frame(30, 0, 100, 'ACTIVE', 'pointer'));
    e.pushFrame(frame(60, 0, 200, 'ACTIVE', 'camera'));
    expect(e.effectiveMs).toBe(200);
  });
});
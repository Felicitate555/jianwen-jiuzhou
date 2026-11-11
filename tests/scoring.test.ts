import { describe, expect, it } from 'vitest';
import { SlashDetector } from '@/combat/slashDetect';

const W = 800; // 舞台宽（px）

function det() {
  return new SlashDetector({
    minPathPx: 0.1 * W, // 80px
    minAvgSpeedPxPerSec: 0.5 * W, // 400px/s
    segmentWindowMs: 600,
    segmentIdleCloseMs: 250,
  });
}

/** 沿对角直线快速划 100px 用时 100ms */
function straightStroke(d: SlashDetector, t0: number, len = 100, ms = 100, step = 5): void {
  const n = Math.ceil(ms / step);
  for (let i = 1; i <= n; i++) {
    const t = t0 + (ms / n) * i;
    const k = (len / n) * i;
    d.feed({ x: 100 + k, y: 100 + k, t }, true, t);
  }
}

describe('SlashDetector 轨迹阈值', () => {
  it('路径长度不足阈值：不产生可结算段', () => {
    const d = det();
    straightStroke(d, 0, 40, 100); // 仅 40 * 1.414 ≈ 56px < 80px
    expect(d.tryStrike()).toBeNull();
  });

  it('平均速度不足阈值：不产生可结算段', () => {
    const d = det();
    straightStroke(d, 0, 150, 2000); // 长度够但 1000ms 太慢（<400px/s）
    expect(d.tryStrike()).toBeNull();
  });

  it('路径与速度均达标：返回可结算段（含直线率数据）', () => {
    const d = det();
    straightStroke(d, 0, 100, 100); // ≈141px, 100ms → 1410px/s
    const seg = d.tryStrike();
    expect(seg).not.toBeNull();
    expect(seg!.pathLen).toBeGreaterThan(80);
    expect(seg!.avgSpeed * 1000).toBeGreaterThan(400);
    // 直线率 = straightDist / pathLen ≈ 1
    expect(seg!.straightDist / seg!.pathLen).toBeCloseTo(1, 1);
  });

  it('抖动绕动轨迹：直线率显著降低（稳定度惩罚数据来源）', () => {
    const d = det();
    // 之字形：x 前进 150，y 往复 ±20
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 5;
      d.feed({ x: 100 + i * 5, y: 100 + (i % 2 === 0 ? 20 : -20), t }, true, t);
    }
    const seg = d.tryStrike()!;
    expect(seg).not.toBeNull();
    expect(seg.straightDist / seg.pathLen).toBeLessThan(0.7);
  });

  it('离开 ACTIVE 即关闭当前段', () => {
    const d = det();
    straightStroke(d, 0, 100, 100);
    d.feed({ x: 300, y: 300, t: 150 }, false, 150);
    expect(d.tryStrike()).toBeNull();
  });

  it('段超时（>600ms）作废并从新段重新累计', () => {
    const d = det();
    let t = 0;
    // 缓慢喂点把段拖过 window
    for (let i = 0; i < 20; i++) {
      t += 50;
      d.feed({ x: 100 + i, y: 100, t }, true, t);
    }
    // 旧段应已因超时作废，新段不足阈值
    expect(d.tryStrike()).toBeNull();
  });
});

describe('一次穿越一次命中', () => {
  it('markConsumed 后同段不可再结算；新段需重新累计', () => {
    const d = det();
    straightStroke(d, 0, 100, 100); // 第一段
    expect(d.tryStrike()).not.toBeNull();
    d.markConsumed();
    // 剑尖停在原地：同段（consumed）不可再结算
    expect(d.tryStrike()).toBeNull();
    // 离开 ACTIVE 再回来形成新段，但新段路径不足
    d.feed({ x: 250, y: 250, t: 300 }, false, 300);
    d.feed({ x: 250, y: 250, t: 400 }, true, 400);
    d.feed({ x: 260, y: 255, t: 450 }, true, 450);
    expect(d.tryStrike()).toBeNull();
    // 新段累计足量后可再次结算
    straightStroke(d, 500, 120, 120);
    const seg2 = d.tryStrike();
    expect(seg2).not.toBeNull();
    expect(seg2!.id).toBeGreaterThan(1);
  });

  it('tickIdle：剑尖停顿超过 idleCloseMs 关闭段', () => {
    const d = det();
    straightStroke(d, 0, 100, 100);
    // 剑尖停住 260ms
    d.tickIdle(100 + 260);
    expect(d.tryStrike()).toBeNull();
  });
});
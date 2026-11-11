import { describe, expect, it } from 'vitest';
import {
  applyDisplayDeadZone,
  DISPLAY_DEAD_ZONE_PX,
  TRAIL_COLORS,
} from '@/render/trailRenderer';
import { SwordEngine } from '@/engine/swordEngine';

describe('剑尖显示 dead zone（仅显示层，约 2 CSS px）', () => {
  it('默认阈值约 2px', () => {
    expect(DISPLAY_DEAD_ZONE_PX).toBeGreaterThanOrEqual(1.5);
    expect(DISPLAY_DEAD_ZONE_PX).toBeLessThanOrEqual(2.5);
  });

  it('位移小于阈值沿用上次显示位置，抑制亚像素抖动', () => {
    expect(applyDisplayDeadZone({ x: 100, y: 100 }, { x: 101, y: 101 })).toEqual({
      x: 100,
      y: 100,
    }); // 距离 ≈1.41 < 2
  });

  it('位移达到阈值才更新显示位置', () => {
    expect(applyDisplayDeadZone({ x: 100, y: 100 }, { x: 102.5, y: 100 })).toEqual({
      x: 102.5,
      y: 100,
    }); // 距离 2.5 ≥ 2
  });

  it('首次（无上次位置）直接落点', () => {
    expect(applyDisplayDeadZone(null, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('纯函数：不修改入参（显示抑制不回写任何数据流）', () => {
    const prev = { x: 1, y: 1 };
    const next = { x: 1.5, y: 1 };
    const r = applyDisplayDeadZone(prev, next);
    expect(r).toBe(prev);
    expect(prev).toEqual({ x: 1, y: 1 });
    expect(next).toEqual({ x: 1.5, y: 1 });
  });

  it('dead zone 不进入引擎：rawTrail/smoothedTrail 仍保存未抑制的真实数据', () => {
    const e = new SwordEngine();
    // 模拟低于 dead zone 的微小移动（1.5px），raw 与 smooth 均如实记录
    e.pushFrame({ x: 100, y: 100, timestamp: 0, actionState: 'ACTIVE', source: 'camera' });
    e.pushFrame({ x: 101.5, y: 100, timestamp: 40, actionState: 'ACTIVE', source: 'camera' });
    expect(e.rawTrail[1].x).toBe(101.5); // raw 未被显示抑制改写
    expect(e.smoothedTrail[1].x).toBeGreaterThan(100); // 平滑数据独立于显示层
    // 显示层若对末点应用 dead zone，不会改变上述缓冲内容
    applyDisplayDeadZone({ x: 100, y: 100 }, { x: e.smoothedTrail[1].x, y: 100 });
    expect(e.rawTrail[1].x).toBe(101.5);
    expect(TRAIL_COLORS.raw).toBe('#c34540');
    expect(TRAIL_COLORS.smooth).toBe('#cdefe8');
  });
});
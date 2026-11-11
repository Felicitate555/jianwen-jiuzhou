import { describe, expect, it } from 'vitest';
import { mapLandmark8ToCanvas } from '@/engine/mirror';

describe('landmark 8 镜像映射', () => {
  it('同尺寸下执行水平镜像：x = (1 - lm.x) * W，y 直接映射', () => {
    const p = mapLandmark8ToCanvas({ x: 0.25, y: 0.4 }, 800, 600, 800, 600);
    expect(p.x).toBeCloseTo(600, 5);
    expect(p.y).toBeCloseTo(240, 5);
  });

  it('玩家向左移动手（镜像后 lm.x 增大），屏幕剑尖 x 减小', () => {
    // 视频未镜像坐标系中，玩家向自己的左侧移手 → 画面中 lm.x 减小 → 镜像后画布 x 增大
    const left = mapLandmark8ToCanvas({ x: 0.3, y: 0.5 }, 800, 600, 800, 600);
    const right = mapLandmark8ToCanvas({ x: 0.7, y: 0.5 }, 800, 600, 800, 600);
    expect(left.x).toBeGreaterThan(right.x);
  });

  it('object-cover 裁剪时按 cover 缩放映射，不越界', () => {
    // 视频 640x480 填充画布 800x600：scale=1.25，无裁剪偏移
    const p = mapLandmark8ToCanvas({ x: 0.5, y: 0.5 }, 640, 480, 800, 600);
    expect(p.x).toBeCloseTo(400, 5);
    expect(p.y).toBeCloseTo(300, 5);
    // 4:3 视频填 16:9 画布：水平裁剪，边缘 landmark 仍映射在画布内
    const edge = mapLandmark8ToCanvas({ x: 0, y: 0.5 }, 640, 480, 960, 540);
    expect(edge.x).toBeCloseTo(960, 3);
    expect(edge.y).toBeCloseTo(270, 3);
  });

  it('画布尺寸未知时退化为直接镜像，不抛异常', () => {
    const p = mapLandmark8ToCanvas({ x: 0.2, y: 0.3 }, 0, 0, 400, 300);
    expect(p.x).toBeCloseTo(320, 5);
    expect(p.y).toBeCloseTo(90, 5);
  });
});
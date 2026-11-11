import { describe, expect, it } from 'vitest';
import { SwordEngine } from '@/engine/swordEngine';
import { buildUiSnapshot, INITIAL_RUNTIME } from '@/lib/uiSnapshot';
import type { CameraRuntimeStatus } from '@/lib/types';

describe('诊断快照合并（实时值不被初始值覆盖）', () => {
  it('runtime 初始值不覆盖引擎/渲染循环的实时计算值', () => {
    const engine = new SwordEngine();
    engine.pushFrame({ x: 100, y: 200, timestamp: 0, actionState: 'ACTIVE', source: 'camera' });
    engine.pushFrame({ x: 140, y: 200, timestamp: 100, actionState: 'ACTIVE', source: 'camera' });

    const snapshot = buildUiSnapshot(engine, { ...INITIAL_RUNTIME }, 'camera', 58);

    // 以下字段必须来自实时计算，而非 INITIAL_UI 的初始值
    expect(snapshot.mode).toBe('camera'); // 初始值为 'pointer'，不得覆盖
    expect(snapshot.actionState).toBe('ACTIVE');
    expect(snapshot.effectiveMs).toBe(100); // 引擎真实累计（位移 40 > 8 阈值）
    expect(snapshot.success).toBe(false);
    expect(snapshot.raw?.x).toBe(140); // 真实 raw 末点
    expect(snapshot.smooth?.x).toBeGreaterThan(100); // 平滑末点（EMA 未追上 raw）
    expect(snapshot.renderFps).toBe(58); // 渲染循环统计

    // 运行时字段仍如实来自 runtime（未被清空或替换）
    expect(snapshot.cameraStatus).toBe('idle');
    expect(snapshot.mediapipeStatus).toBe('uninitialized');
    expect(snapshot.detectionFps).toBe(0);
  });

  it('runtime 字段更新时如实反映，engine 计算值仍独立不串扰', () => {
    const engine = new SwordEngine();
    engine.pushFrame({ x: 0, y: 0, timestamp: 0, actionState: 'SHEATHED', source: 'pointer' });
    const runtime: CameraRuntimeStatus = {
      ...INITIAL_RUNTIME,
      cameraStatus: 'running',
      mediapipeStatus: 'ready',
      handDetected: true,
      inferenceMs: 8.4,
      detectionFps: 24,
      lastError: null,
    };
    const snapshot = buildUiSnapshot(engine, runtime, 'pointer', 60);

    expect(snapshot.cameraStatus).toBe('running');
    expect(snapshot.mediapipeStatus).toBe('ready');
    expect(snapshot.handDetected).toBe(true);
    expect(snapshot.inferenceMs).toBe(8.4);
    expect(snapshot.detectionFps).toBe(24);
    expect(snapshot.mode).toBe('pointer');
    expect(snapshot.actionState).toBe('SHEATHED'); // 来自引擎，非 runtime
  });

  it('丢手后 actionState 回落 IDLE，且 raw/smooth 保留最近真实轨迹点', () => {
    const engine = new SwordEngine();
    engine.pushFrame({ x: 10, y: 10, timestamp: 0, actionState: 'ACTIVE', source: 'camera' });
    engine.pushFrame({ x: -1, y: -1, timestamp: 80, actionState: 'IDLE', source: 'camera' });
    const snapshot = buildUiSnapshot(engine, { ...INITIAL_RUNTIME }, 'camera', 60);
    expect(snapshot.actionState).toBe('IDLE');
    expect(snapshot.raw?.x).toBe(10); // 最后一个非 IDLE raw 点
    expect(snapshot.smooth?.x).toBe(10);
  });
});
/**
 * UI 诊断快照：把输入层运行时状态（CameraRuntimeStatus）与引擎/渲染循环的
 * 实时计算值合并为单一 UI 状态。
 *
 * 合并顺序约定：先展开 runtime（仅摄像头/MediaPipe 运行时字段），
 * 再以实时计算值覆盖 mode/actionState/effectiveMs/success/raw/smooth/renderFps，
 * 确保这些字段永远来自引擎与渲染循环，而不是初始值（修复此前的覆盖 Bug）。
 */
import type { SwordEngine } from '@/engine/swordEngine';
import type { ActionState, CameraRuntimeStatus, InputSource, TrailPoint } from '@/lib/types';

export interface UiState extends CameraRuntimeStatus {
  mode: InputSource;
  actionState: ActionState;
  effectiveMs: number;
  success: boolean;
  raw: TrailPoint | null;
  smooth: TrailPoint | null;
  renderFps: number;
}

/** 输入层运行时初始状态（不含 UI 计算值，避免被误当作 UI 初值展开） */
export const INITIAL_RUNTIME: CameraRuntimeStatus = {
  cameraStatus: 'idle',
  mediapipeStatus: 'uninitialized',
  handDetected: false,
  inferenceMs: null,
  detectionFps: 0,
  lastError: null,
};

export const INITIAL_UI: UiState = {
  ...INITIAL_RUNTIME,
  mode: 'pointer',
  actionState: 'IDLE',
  effectiveMs: 0,
  success: false,
  raw: null,
  smooth: null,
  renderFps: 0,
};

/** 引擎快照所需的最小接口（便于测试，不耦合完整 SwordEngine） */
export type EngineSnapshot = Pick<
  SwordEngine,
  'lastFrame' | 'effectiveMs' | 'success' | 'lastRawPoint' | 'lastSmoothedPoint'
>;

/** 构建诊断快照：runtime 打底，引擎/渲染循环实时值覆盖，杜绝初始值覆盖实时值 */
export function buildUiSnapshot(
  engine: EngineSnapshot,
  runtime: CameraRuntimeStatus,
  mode: InputSource,
  renderFps: number,
): UiState {
  return {
    ...runtime,
    mode,
    actionState: engine.lastFrame?.actionState ?? 'IDLE',
    effectiveMs: engine.effectiveMs,
    success: engine.success,
    raw: engine.lastRawPoint,
    smooth: engine.lastSmoothedPoint,
    renderFps,
  };
}
/** 动作状态：ACTIVE=出剑（手部张开检测到手/按下拖动），SHEATHED=握拳收势/松开，IDLE=丢失手/未交互 */
export type ActionState = 'ACTIVE' | 'SHEATHED' | 'IDLE';

/** 输入来源 */
export type InputSource = 'camera' | 'pointer';

/** 统一输入帧：CameraHandInput 与 PointerInput 只能通过该协议向 SwordEngine 供数 */
export interface InputFrame {
  x: number;
  y: number;
  timestamp: number;
  actionState: ActionState;
  source: InputSource;
}

/** 轨迹点（带时间戳与动作状态，状态用于渲染分段：收势后轨迹停止绘制） */
export interface TrailPoint {
  x: number;
  y: number;
  t: number;
  a: ActionState;
}

/** 摄像头运行状态 */
export type CameraStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'failed';

/** MediaPipe 初始化状态 */
export type MediapipeStatus = 'uninitialized' | 'loading' | 'ready' | 'failed';

/** 摄像头输入运行时状态（供诊断面板） */
export interface CameraRuntimeStatus {
  cameraStatus: CameraStatus;
  mediapipeStatus: MediapipeStatus;
  handDetected: boolean;
  inferenceMs: number | null;
  detectionFps: number;
  lastError: string | null;
}

/** 引擎配置 */
export interface EngineConfig {
  /** 有效移动抖动阈值（CSS 像素） */
  jitterThresholdPx: number;
  /** 御剑成功目标累计时长（毫秒） */
  targetEffectiveMs: number;
  /** 轨迹保留时长（毫秒），超时剔除 */
  trailTtlMs: number;
  /** 相邻有效样本最大间隔，超过则不计入累计 */
  maxSampleGapMs: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  jitterThresholdPx: 8,
  targetEffectiveMs: 2000,
  trailTtlMs: 2600,
  maxSampleGapMs: 400,
};
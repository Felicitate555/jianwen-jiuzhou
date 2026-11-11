/**
 * 摄像头手势输入：真实 getUserMedia + MediaPipe HandLandmarker（VIDEO, numHands=1）。
 *
 * 约束：
 * - 必须由用户点击「启用摄像头」后才调用 getUserMedia（本类不自动启动）；
 * - 优先静态资源 public/mediapipe（WASM + hand_landmarker.task），GPU 失败回退 CPU；
 * - 检测循环约 25FPS、带 in-flight 锁，与渲染 rAF 分离；
 * - start/stop 幂等；generation token 防止旧异步任务复活；
 * - 任何时刻仅一个 MediaStream、一个 HandLandmarker、一个检测循环；
 * - visibilitychange 后台暂停，回前台校验资源有效性后复用或重建。
 *
 * 本类只提供 landmark 输入：剑尖取 landmark 8（镜像映射后输出），
 * 握拳仅做粗粒度二值判断（经 150ms 防抖），不参与任何游戏规则。
 */
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { ActionState, CameraRuntimeStatus, InputFrame } from '@/lib/types';
import { ActionStateDebouncer } from '@/engine/actionStateDebouncer';
import { DetectionLoop } from '@/engine/detectionLoop';
import { isFistCandidate } from '@/engine/fistDetect';
import { mapLandmark8ToCanvas } from '@/engine/mirror';
import type { InputAdapter } from './inputManager';

const DETECT_INTERVAL_MS = 40; // 检测周期：开始到开始约 40ms（约 25FPS），推理耗时计入周期内
const INIT_TIMEOUT_MS = 15000;
const FPS_WINDOW_MS = 1000;

export interface CameraInputDeps {
  /** 可注入的 Landmarker 工厂（测试用），默认走静态资源 + GPU→CPU 回退 */
  createLandmarker?: (delegate: 'GPU' | 'CPU') => Promise<HandLandmarker>;
  intervalMs?: number;
  initTimeoutMs?: number;
}

function resolveAsset(path: string): string {
  // 相对 document.baseURI 解析，兼容子路径部署
  return new URL(path, document.baseURI).toString();
}

async function defaultCreateLandmarker(delegate: 'GPU' | 'CPU'): Promise<HandLandmarker> {
  const wasmPath = resolveAsset('mediapipe/wasm');
  const modelPath = resolveAsset('mediapipe/hand_landmarker.task');
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelPath, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 超时后若底层仍完成，关闭实例避免泄漏
      p.then((v) => {
        if (v && typeof (v as { close?: () => void }).close === 'function') {
          try {
            (v as unknown as { close: () => void }).close();
          } catch {
            /* 忽略关闭异常 */
          }
        }
      }).catch(() => undefined);
      reject(new Error(`${msg}（${ms}ms）`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function describeCameraError(err: unknown): string {
  if (err instanceof DOMException || (err instanceof Error && err.name)) {
    switch (err.name) {
      case 'NotAllowedError':
        return '摄像头权限被拒绝：请在浏览器地址栏权限设置中允许摄像头后重试';
      case 'NotFoundError':
        return '未找到可用的摄像头设备';
      case 'NotReadableError':
        return '摄像头被其他应用占用，无法读取画面';
      case 'OverconstrainedError':
        return '当前摄像头不满足前置摄像头约束（facingMode:user）';
      default:
        return err instanceof Error ? err.message : String(err);
    }
  }
  return err instanceof Error ? err.message : String(err);
}

function releaseStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* 忽略 */
    }
  }
}

export class CameraHandInput implements InputAdapter {
  readonly source = 'camera' as const;

  private generation = 0;
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private loop: DetectionLoop | null = null;
  private debouncer = new ActionStateDebouncer(150);
  private lastVideoTime = -1;
  private running = false;
  private pendingStart: Promise<void> | null = null;
  private inflight = false;
  private fpsSamples: number[] = [];

  constructor(
    private video: HTMLVideoElement,
    private stage: HTMLElement,
    private onFrame: (frame: InputFrame) => void,
    private onStatus: (s: Partial<CameraRuntimeStatus>) => void,
    private deps: CameraInputDeps = {},
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * 用户点击「启用摄像头」后调用；幂等。
   * 若旧启动流程仍在收尾（例如刚被 stop 打断），先等待其完全落定再发起，
   * 保证任一时刻最多一个 MediaStream / HandLandmarker / 检测循环。
   */
  async start(): Promise<void> {
    if (this.running) return;
    if (this.pendingStart) {
      await this.pendingStart.catch(() => undefined);
      if (this.running) return;
    }
    this.pendingStart = this.performStart();
    try {
      await this.pendingStart;
    } finally {
      this.pendingStart = null;
    }
  }

  private async performStart(): Promise<void> {
    const gen = ++this.generation;
    try {
      this.checkEnvironment();
      this.onStatus({ cameraStatus: 'starting', lastError: null });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (gen !== this.generation) {
        // 启动期间被停止/切换：立即释放，不复活
        releaseStream(stream);
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      try {
        await this.video.play();
      } catch {
        /* 部分浏览器自动播放受限，静音视频通常可播放；失败不阻断检测 */
      }
      if (gen !== this.generation) {
        this.hardCleanup();
        return;
      }
      this.onStatus({ cameraStatus: 'running' });

      this.onStatus({ mediapipeStatus: 'loading' });
      const landmarker = await withTimeout(
        this.initLandmarker(),
        this.deps.initTimeoutMs ?? INIT_TIMEOUT_MS,
        'MediaPipe 初始化超时',
      );
      if (gen !== this.generation) {
        try {
          landmarker.close();
        } catch {
          /* 忽略 */
        }
        this.hardCleanup();
        return;
      }
      this.landmarker = landmarker;
      this.onStatus({ mediapipeStatus: 'ready' });

      this.running = true;
      this.lastVideoTime = -1;
      this.fpsSamples = [];
      this.loop = new DetectionLoop(this.deps.intervalMs ?? DETECT_INTERVAL_MS, () =>
        this.detectOnce(),
      );
      this.loop.start();
      document.addEventListener('visibilitychange', this.handleVisibility);
    } catch (err) {
      this.running = false;
      this.hardCleanup();
      const message = describeCameraError(err);
      this.onStatus({ cameraStatus: 'failed', lastError: message });
      throw new Error(message);
    }
  }

  /** 停止并释放全部资源；幂等；切换到 Pointer 时由 InputManager 调用 */
  stop(): void {
    this.generation++;
    this.running = false;
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.hardCleanup();
    this.debouncer.reset();
    this.onStatus({
      cameraStatus: 'stopped',
      mediapipeStatus: 'uninitialized',
      handDetected: false,
      inferenceMs: null,
      detectionFps: 0,
    });
  }

  private hardCleanup(): void {
    if (this.loop) {
      this.loop.stop();
      this.loop = null;
    }
    this.inflight = false;
    if (this.video.srcObject) {
      this.video.srcObject = null;
    }
    releaseStream(this.stream);
    this.stream = null;
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* 忽略 */
      }
      this.landmarker = null;
    }
    this.lastVideoTime = -1;
    this.fpsSamples = [];
  }

  private checkEnvironment(): void {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error('非安全上下文：摄像头需要 HTTPS 或 localhost 环境');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头访问（缺少 mediaDevices.getUserMedia）');
    }
  }

  private async initLandmarker(): Promise<HandLandmarker> {
    const create = this.deps.createLandmarker ?? defaultCreateLandmarker;
    try {
      return await create('GPU');
    } catch (gpuErr) {
      try {
        return await create('CPU');
      } catch (cpuErr) {
        const gpuMsg = gpuErr instanceof Error ? gpuErr.message : String(gpuErr);
        const cpuMsg = cpuErr instanceof Error ? cpuErr.message : String(cpuErr);
        this.onStatus({ mediapipeStatus: 'failed' });
        throw new Error(
          `HandLandmarker 初始化失败（GPU 与 CPU 均失败）。GPU: ${gpuMsg}；CPU: ${cpuMsg}`,
        );
      }
    }
  }

  private detectOnce(): void {
    const landmarker = this.landmarker;
    if (!landmarker || !this.running) return;
    if (this.video.readyState < 2 || this.video.videoWidth <= 0) return;
    // in-flight 锁：上一帧未完成时不重复推理（detectForVideo 为同步调用，此锁防御异常路径）
    if (this.inflight) return;
    const ts = performance.now();
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    this.inflight = true;
    let result: HandLandmarkerResult;
    try {
      result = landmarker.detectForVideo(this.video, ts);
    } catch (err) {
      this.inflight = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.onStatus({ lastError: `手部推理失败：${msg}` });
      return;
    }
    this.inflight = false;

    const inferenceMs = performance.now() - ts;
    this.recordFps(ts);
    this.handleResult(result, ts, inferenceMs);
  }

  private handleResult(result: HandLandmarkerResult, ts: number, inferenceMs: number): void {
    const landmarks = result.landmarks?.[0];
    const rect = this.stage.getBoundingClientRect();
    if (!landmarks || landmarks.length < 21) {
      // 丢失手：立即 IDLE
      const state = this.debouncer.update('IDLE', ts);
      this.onStatus({ handDetected: false, inferenceMs });
      this.onFrame({ x: -1, y: -1, timestamp: ts, actionState: state, source: 'camera' });
      return;
    }
    // 剑尖：仅取 landmark 8，镜像映射到画布 CSS 像素坐标
    const p = mapLandmark8ToCanvas(
      landmarks[8],
      this.video.videoWidth,
      this.video.videoHeight,
      rect.width,
      rect.height,
    );
    // 粗粒度握拳二值判断 + 150ms 防抖
    const rawState: ActionState = isFistCandidate(landmarks) ? 'SHEATHED' : 'ACTIVE';
    const state = this.debouncer.update(rawState, ts);
    this.onStatus({ handDetected: true, inferenceMs });
    this.onFrame({ x: p.x, y: p.y, timestamp: ts, actionState: state, source: 'camera' });
  }

  private recordFps(now: number): void {
    this.fpsSamples.push(now);
    while (this.fpsSamples.length > 0 && now - this.fpsSamples[0] > FPS_WINDOW_MS) {
      this.fpsSamples.shift();
    }
    this.onStatus({ detectionFps: this.fpsSamples.length });
  }

  private handleVisibility = (): void => {
    if (document.hidden) {
      // 进入后台：暂停检测循环
      if (this.loop) {
        this.loop.stop();
        this.loop = null;
      }
      if (this.running) {
        this.onStatus({ cameraStatus: 'paused' });
      }
      return;
    }
    if (!this.running) return;
    // 回前台：先校验资源有效性，有效则复用恢复，失效才重建
    const streamAlive =
      this.stream !== null && this.stream.getTracks().some((t) => t.readyState === 'live');
    const videoAlive = this.video.readyState >= 2 && this.video.videoWidth > 0;
    if (streamAlive && videoAlive && this.landmarker) {
      this.lastVideoTime = -1;
      this.loop = new DetectionLoop(this.deps.intervalMs ?? DETECT_INTERVAL_MS, () =>
        this.detectOnce(),
      );
      this.loop.start();
      this.onStatus({ cameraStatus: 'running' });
    } else {
      // 资源失效：停止旧资源后重新初始化
      this.generation++;
      this.running = false;
      this.hardCleanup();
      void this.start().catch(() => undefined);
    }
  };
}
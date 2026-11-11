import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraHandInput, type CameraInputDeps } from '@/input/cameraHandInput';
import type { CameraRuntimeStatus, InputFrame } from '@/lib/types';
import type { LandmarkLike } from '@/engine/mirror';

/**
 * 摄像头输入生命周期测试：全部使用 mock 的 getUserMedia / HandLandmarker / video，
 * 不伪造真实摄像头识别（仅验证生命周期、清理、防复活与统一协议输出）。
 */

interface LandmarkerMock {
  detectForVideo: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  delegate: 'GPU' | 'CPU';
}

/** 张手：指尖远离掌心（非握拳） */
const OPEN_HAND: LandmarkLike[] = Array.from({ length: 21 }, (_, i) => {
  if (i === 9) return { x: 0.5, y: 0.5 };
  if (i === 8 || i === 12 || i === 16 || i === 20) return { x: 0.5, y: 0.15 };
  if (i === 6 || i === 10 || i === 14 || i === 18) return { x: 0.5, y: 0.32 };
  return { x: 0.4, y: 0.6 };
});

/** 握拳：指尖靠近掌心 */
const FIST_HAND: LandmarkLike[] = Array.from({ length: 21 }, (_, i) => {
  if (i === 9) return { x: 0.5, y: 0.5 };
  if (i === 8 || i === 12 || i === 16 || i === 20) return { x: 0.5, y: 0.47 };
  if (i === 6 || i === 10 || i === 14 || i === 18) return { x: 0.5, y: 0.35 };
  return { x: 0.45, y: 0.55 };
});

interface VideoMock {
  srcObject: unknown;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  play(): Promise<void>;
}

function makeVideoMock(): VideoMock {
  let t = 0;
  return {
    srcObject: null,
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    get currentTime() {
      t += 1 / 25;
      return t;
    },
    play: async () => undefined,
  };
}

function makeTrack() {
  return { stop: vi.fn(), readyState: 'live' as const };
}

interface Harness {
  input: CameraHandInput;
  frames: InputFrame[];
  status: CameraRuntimeStatus;
  gum: ReturnType<typeof vi.fn>;
  video: VideoMock;
  landmarkers: LandmarkerMock[];
  track: ReturnType<typeof makeTrack>;
  docListeners: Map<string, () => void>;
  detectCalls: () => number;
}

function setup(opts: { gpuFail?: Error; cpuFail?: Error; gumReject?: Error } = {}): Harness {
  const frames: InputFrame[] = [];
  const status: CameraRuntimeStatus = {
    cameraStatus: 'idle',
    mediapipeStatus: 'uninitialized',
    handDetected: false,
    inferenceMs: null,
    detectionFps: 0,
    lastError: null,
  };
  const landmarkers: LandmarkerMock[] = [];
  const current: LandmarkLike[] | null = OPEN_HAND;
  const createLandmarker = async (delegate: 'GPU' | 'CPU'): Promise<LandmarkerMock> => {
    if (delegate === 'GPU' && opts.gpuFail) throw opts.gpuFail;
    if (delegate === 'CPU' && opts.cpuFail) throw opts.cpuFail;
    const lm: LandmarkerMock = {
      delegate,
      detectForVideo: vi.fn(() => ({ landmarks: current ? [current] : [] })),
      close: vi.fn(),
    };
    landmarkers.push(lm);
    return lm;
  };
  const video = makeVideoMock();
  const stage = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const track = makeTrack();
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const gum = vi.fn(async () => {
    if (opts.gumReject) throw opts.gumReject;
    return stream;
  });
  const docListeners = new Map<string, () => void>();
  const docMock = {
    hidden: false,
    addEventListener: (t: string, f: () => void) => docListeners.set(t, f),
    removeEventListener: (t: string) => docListeners.delete(t),
  };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } });
  vi.stubGlobal('document', docMock);

  const input = new CameraHandInput(
    video as unknown as HTMLVideoElement,
    stage as unknown as HTMLElement,
    (f) => frames.push(f),
    (patch) => Object.assign(status, patch),
    {
      createLandmarker: createLandmarker as unknown as CameraInputDeps['createLandmarker'],
      intervalMs: 10,
    },
  );
  return {
    input,
    frames,
    status,
    gum,
    video,
    landmarkers,
    track,
    docListeners,
    detectCalls: () => landmarkers.reduce((n, lm) => n + lm.detectForVideo.mock.calls.length, 0),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // performance.now 挂到假时钟（vitest 默认伪造 Date），保证防抖时序可控
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function step(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('CameraHandInput 生命周期', () => {
  it('start 后创建单一 stream/landmarker/循环，输出 camera 来源输入帧与镜像坐标', async () => {
    const h = setup();
    await h.input.start();
    expect(h.gum).toHaveBeenCalledTimes(1);
    expect(h.gum.mock.calls[0][0]).toMatchObject({
      audio: false,
      video: { facingMode: 'user' },
    });
    expect(h.landmarkers).toHaveLength(1);
    expect(h.landmarkers[0].delegate).toBe('GPU');
    expect(h.status.cameraStatus).toBe('running');
    expect(h.status.mediapipeStatus).toBe('ready');

    await step(300); // 10ms 间隔检测；张手稳定 150ms 后提交 ACTIVE
    expect(h.detectCalls()).toBeGreaterThanOrEqual(10);
    const camFrames = h.frames.filter((f) => f.source === 'camera');
    expect(camFrames.length).toBeGreaterThan(0);
    expect(h.frames.some((f) => f.actionState === 'ACTIVE')).toBe(true);
    const active = h.frames.find((f) => f.actionState === 'ACTIVE')!;
    // landmark8(0.5,0.15) 镜像映射到 800x600 画布（4:3 无裁剪）：x=(1-0.5)*800=400, y=0.15*600=90
    expect(active.x).toBeCloseTo(400, 1);
    expect(active.y).toBeCloseTo(90, 1);
    expect(h.status.handDetected).toBe(true);

    h.input.stop();
  });

  it('stop 释放全部资源：track 停止、srcObject 清空、landmarker 关闭、循环停止且不复活', async () => {
    const h = setup();
    await h.input.start();
    await step(30);
    const calls = h.detectCalls();

    h.input.stop();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.video.srcObject).toBeNull();
    expect(h.landmarkers[0].close).toHaveBeenCalledTimes(1);
    expect(h.status.cameraStatus).toBe('stopped');

    await step(100);
    expect(h.detectCalls()).toBe(calls); // 循环已死，不再有检测

    h.input.stop(); // 幂等
    expect(h.landmarkers[0].close).toHaveBeenCalledTimes(1);
    expect(h.track.stop).toHaveBeenCalledTimes(1);
  });

  it('Camera→Pointer 切换后立即停止占用，随后重新启动不产生并行循环', async () => {
    const h = setup();
    await h.input.start();
    await step(20);

    h.input.stop(); // 模拟切换到 Pointer
    await step(20);
    const afterStop = h.detectCalls();
    expect(h.detectCalls()).toBe(afterStop);
    expect(h.landmarkers[0].close).toHaveBeenCalledTimes(1); // 旧实例已关闭

    await h.input.start(); // 重新启动：创建新实例，但同一时刻仅一个
    await step(20);
    expect(h.landmarkers).toHaveLength(2); // 新 landmarker
    expect(h.landmarkers[1].delegate).toBe('GPU');
    expect(h.gum).toHaveBeenCalledTimes(2);
    const mid = h.detectCalls();
    await step(20);
    // 10ms 间隔 → 增量约 2；若存在并行循环会接近翻倍
    expect(h.detectCalls() - mid).toBeLessThanOrEqual(6);

    h.input.stop();
  });

  it('start 未落定时立即 stop：generation token 阻止旧流程复活', async () => {
    const h = setup();
    const p = h.input.start();
    h.input.stop(); // getUserMedia 仍 pending
    await p; // 旧 start 收尾
    expect(h.track.stop).toHaveBeenCalled(); // stream 已释放
    expect(h.landmarkers).toHaveLength(0); // 未创建 landmarker
    expect(h.video.srcObject).toBeNull();

    await step(50);
    expect(h.detectCalls()).toBe(0);
    expect(h.gum).toHaveBeenCalledTimes(1);
  });

  it('重复 start 幂等：不重复申请摄像头、不叠加检测频率', async () => {
    const h = setup();
    const p1 = h.input.start();
    const p2 = h.input.start();
    await Promise.all([p1, p2]);
    await step(30);
    expect(h.gum).toHaveBeenCalledTimes(1);
    expect(h.landmarkers).toHaveLength(1);
    const mid = h.detectCalls();
    await step(20);
    expect(h.detectCalls() - mid).toBeLessThanOrEqual(6);
    h.input.stop();
  });

  it('GPU 失败时回退 CPU 初始化', async () => {
    const h = setup({ gpuFail: new Error('WebGL not supported') });
    await h.input.start();
    expect(h.landmarkers).toHaveLength(1);
    expect(h.landmarkers[0].delegate).toBe('CPU');
    expect(h.status.mediapipeStatus).toBe('ready');
    h.input.stop();
  });

  it('GPU 与 CPU 均失败：抛出可诊断错误并完整清理', async () => {
    const h = setup({ gpuFail: new Error('gpu down'), cpuFail: new Error('wasm missing') });
    await expect(h.input.start()).rejects.toThrow(/GPU 与 CPU 均失败/);
    expect(h.status.cameraStatus).toBe('failed');
    expect(h.status.mediapipeStatus).toBe('failed');
    expect(h.status.lastError).toMatch(/GPU 与 CPU 均失败/);
    expect(h.landmarkers).toHaveLength(0);
    await step(50);
    expect(h.detectCalls()).toBe(0);
  });

  it('摄像头权限被拒绝：抛出友好错误信息，Pointer 模式仍可独立工作', async () => {
    const h = setup({ gumReject: new DOMException('Permission denied', 'NotAllowedError') });
    await expect(h.input.start()).rejects.toThrow(/权限被拒绝/);
    expect(h.status.cameraStatus).toBe('failed');

    // Pointer 降级不依赖摄像头：同一页面内 PointerInput 可正常启动（见 inputManager 测试）
    const { PointerInput } = await import('@/input/pointerInput');
    const frames: InputFrame[] = [];
    const el = {
      listeners: {} as Record<string, (e: unknown) => void>,
      addEventListener(t: string, f: (e: unknown) => void) {
        this.listeners[t] = f;
      },
      removeEventListener(t: string) {
        delete this.listeners[t];
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture: vi.fn(),
    };
    const pointer = new PointerInput((f) => frames.push(f), () => el as unknown as HTMLElement);
    pointer.start();
    el.listeners['pointerdown']({ clientX: 10, clientY: 10, pointerId: 1 });
    expect(frames[0]).toMatchObject({ x: 10, y: 10, actionState: 'ACTIVE', source: 'pointer' });
    pointer.stop();
  });

  it('握拳收势与丢失手：SHEATHED 需 150ms 稳定，丢手立即 IDLE', async () => {
    const h = setup();
    await h.input.start();
    await step(200); // 张手稳定 → ACTIVE
    expect(h.frames[h.frames.length - 1].actionState).toBe('ACTIVE');

    // 丢失手：立即 IDLE
    h.landmarkers[0].detectForVideo.mockImplementation(() => ({ landmarks: [] }));
    await step(20);
    expect(h.frames[h.frames.length - 1].actionState).toBe('IDLE');
    expect(h.status.handDetected).toBe(false);

    // 恢复张手 → 重新稳定 150ms 后 ACTIVE
    h.landmarkers[0].detectForVideo.mockImplementation(() => ({ landmarks: [OPEN_HAND] }));
    await step(60);
    expect(h.frames[h.frames.length - 1].actionState).toBe('IDLE'); // 未满 150ms
    await step(200);
    expect(h.frames[h.frames.length - 1].actionState).toBe('ACTIVE');

    // 握拳 → 150ms 稳定后 SHEATHED
    h.landmarkers[0].detectForVideo.mockImplementation(() => ({ landmarks: [FIST_HAND] }));
    await step(60);
    expect(h.frames[h.frames.length - 1].actionState).toBe('ACTIVE'); // 未满 150ms
    await step(200);
    expect(h.frames[h.frames.length - 1].actionState).toBe('SHEATHED');
    h.input.stop();
  });

  it('进入后台暂停检测，回前台校验资源后复用恢复（不重建实例）', async () => {
    const h = setup();
    await h.input.start();
    await step(30);
    const before = h.detectCalls();

    const onVis = h.docListeners.get('visibilitychange');
    expect(onVis).toBeTruthy();

    (globalThis.document as unknown as { hidden: boolean }).hidden = true;
    onVis!();
    await step(50);
    expect(h.detectCalls()).toBe(before); // 后台暂停
    expect(h.status.cameraStatus).toBe('paused');

    (globalThis.document as unknown as { hidden: boolean }).hidden = false;
    onVis!();
    await step(30);
    expect(h.detectCalls()).toBeGreaterThan(before); // 恢复检测
    expect(h.landmarkers).toHaveLength(1); // 未重建 landmarker
    expect(h.gum).toHaveBeenCalledTimes(1); // 未重新申请摄像头
    expect(h.status.cameraStatus).toBe('running');
    h.input.stop();
  });
});
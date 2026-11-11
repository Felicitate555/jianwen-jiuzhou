/**
 * 御剑引擎：只消费 InputManager 输出的统一输入帧，
 * 不感知、不分叉输入来自摄像头还是指针。
 *
 * 职责（本轮范围）：
 * 1. 双轨迹缓冲：rawTrail（镜像映射后、未平滑）与 smoothedTrail（EMA 平滑后），
 *    两条数据流彼此独立、带时间戳；raw 在 EMA 之前入缓冲。
 * 2. 2 秒有效移动累计：仅 actionState=ACTIVE 且相邻样本位移超过抖动阈值时累计；
 *    静止、SHEATHED、IDLE、丢手只暂停累计，不清零。
 * 3. 成功判定：累计达到目标时长即 success=true。
 */
import { AdaptiveEma } from './adaptiveEma';
import {
  DEFAULT_ENGINE_CONFIG,
  type EngineConfig,
  type InputFrame,
  type TrailPoint,
} from '@/lib/types';

export class SwordEngine {
  readonly rawTrail: TrailPoint[] = [];
  readonly smoothedTrail: TrailPoint[] = [];

  private ema = new AdaptiveEma();
  private lastActiveSample: { x: number; y: number; t: number } | null = null;
  private _effectiveMs = 0;
  private _success = false;
  private _lastFrame: InputFrame | null = null;

  constructor(private cfg: EngineConfig = DEFAULT_ENGINE_CONFIG) {}

  get effectiveMs(): number {
    return Math.min(this._effectiveMs, this.cfg.targetEffectiveMs);
  }

  get success(): boolean {
    return this._success;
  }

  get lastFrame(): InputFrame | null {
    return this._lastFrame;
  }

  get lastRawPoint(): TrailPoint | null {
    return this.rawTrail.length > 0 ? this.rawTrail[this.rawTrail.length - 1] : null;
  }

  get lastSmoothedPoint(): TrailPoint | null {
    return this.smoothedTrail.length > 0
      ? this.smoothedTrail[this.smoothedTrail.length - 1]
      : null;
  }

  /** 处理一帧统一输入 */
  pushFrame(frame: InputFrame): void {
    this.pruneTrails(frame.timestamp);

    if (frame.actionState !== 'IDLE') {
      // 1) 原始坐标（镜像映射后、未平滑）先入 rawTrail —— 严格先于 EMA
      this.rawTrail.push({ x: frame.x, y: frame.y, t: frame.timestamp, a: frame.actionState });
      // 2) 仅 ACTIVE 时做平滑并追加 smoothedTrail；SHEATHED 时重置 EMA（下次落点直接生效）
      if (frame.actionState === 'ACTIVE') {
        const s = this.ema.update(frame.x, frame.y);
        this.smoothedTrail.push({ x: s.x, y: s.y, t: frame.timestamp, a: 'ACTIVE' });
      } else {
        this.ema.reset();
      }
    } else {
      // 丢失手：重置平滑状态，轨迹暂停
      this.ema.reset();
    }

    this.accumulateEffectiveMovement(frame);
    this._lastFrame = frame;
  }

  /** 有效移动累计：ACTIVE 且相邻样本位移超过抖动阈值才累计时间 */
  private accumulateEffectiveMovement(frame: InputFrame): void {
    if (this._success) return;
    if (frame.actionState === 'ACTIVE') {
      const ref = this.lastActiveSample;
      if (ref !== null) {
        const gap = frame.timestamp - ref.t;
        const moved = Math.hypot(frame.x - ref.x, frame.y - ref.y);
        if (gap > 0 && gap <= this.cfg.maxSampleGapMs && moved > this.cfg.jitterThresholdPx) {
          this._effectiveMs = Math.min(this._effectiveMs + gap, this.cfg.targetEffectiveMs);
        }
      }
      this.lastActiveSample = { x: frame.x, y: frame.y, t: frame.timestamp };
    } else {
      // 静止/收势/丢手：暂停累计（不清零），恢复后首帧仅重建参考点
      this.lastActiveSample = null;
    }
    if (this._effectiveMs >= this.cfg.targetEffectiveMs) {
      this._success = true;
    }
  }

  /** 剔除过期轨迹点 */
  private pruneTrails(now: number): void {
    const cutoff = now - this.cfg.trailTtlMs;
    while (this.rawTrail.length > 0 && this.rawTrail[0].t < cutoff) this.rawTrail.shift();
    while (this.smoothedTrail.length > 0 && this.smoothedTrail[0].t < cutoff) {
      this.smoothedTrail.shift();
    }
  }

  /** 清空有效移动累计与成功状态（轨迹保留） */
  resetProgress(): void {
    this._effectiveMs = 0;
    this._success = false;
    this.lastActiveSample = null;
  }

  /** 全量重置（切换输入模式 / 重新测试） */
  resetAll(): void {
    this.resetProgress();
    this.rawTrail.length = 0;
    this.smoothedTrail.length = 0;
    this.ema.reset();
    this._lastFrame = null;
  }
}
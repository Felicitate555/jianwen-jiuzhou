/**
 * 低延迟自适应 EMA 平滑（第一轮手感校准参数）：
 * - 慢速移动时 alpha≈0.44，抑制手部抖动且少落后；
 * - 中速（≈34px）即进入高 alpha，快速移动时升至 0.84，反向更快追上 raw 点；
 * - 首帧直接落点，不做平滑；reset() 后下一帧同样直接落点。
 */
export interface EmaConfig {
  alphaSlow: number;
  alphaFast: number;
  /** 位移达到该距离（px）时 alpha 升至 alphaFast */
  speedScalePx: number;
}

export const DEFAULT_EMA_CONFIG: EmaConfig = {
  alphaSlow: 0.44,
  alphaFast: 0.84,
  speedScalePx: 34,
};

export class AdaptiveEma {
  private prev: { x: number; y: number } | null = null;

  constructor(private cfg: EmaConfig = DEFAULT_EMA_CONFIG) {}

  get hasPrev(): boolean {
    return this.prev !== null;
  }

  /** 输入原始（已镜像映射）坐标，返回平滑后坐标 */
  update(x: number, y: number): { x: number; y: number } {
    if (!this.prev) {
      this.prev = { x, y };
      return { x, y };
    }
    const dist = Math.hypot(x - this.prev.x, y - this.prev.y);
    const t = Math.min(1, dist / this.cfg.speedScalePx);
    const alpha = this.cfg.alphaSlow + (this.cfg.alphaFast - this.cfg.alphaSlow) * t;
    const nx = this.prev.x + (x - this.prev.x) * alpha;
    const ny = this.prev.y + (y - this.prev.y) * alpha;
    this.prev = { x: nx, y: ny };
    return { x: nx, y: ny };
  }

  /** 丢失手 / 收势后重置，下一帧直接落点 */
  reset(): void {
    this.prev = null;
  }
}
/**
 * 剑痕渲染器：只负责把引擎的双轨迹画到 canvas，不涉及输入与规则。
 * 视觉基调：克制的国风仙侠电影感——青白色剑气实线 + 轻微光晕，
 * 朱红色原始轨迹点状细线（调试对照），按时间衰减。
 */
import type { TrailPoint } from '@/lib/types';

export interface TrailRenderInput {
  rawTrail: TrailPoint[];
  smoothedTrail: TrailPoint[];
  showRaw: boolean;
  showSmooth: boolean;
  swordTip: { x: number; y: number } | null;
  now: number;
  trailTtlMs: number;
}

export const TRAIL_COLORS = {
  raw: '#c34540',
  smooth: '#cdefe8',
} as const;

/** 显示层极小 dead zone 阈值（CSS px）：仅抑制剑尖光点的亚像素级抖动 */
export const DISPLAY_DEAD_ZONE_PX = 2;

/**
 * 剑尖光点显示 dead zone：位移小于阈值时沿用上次显示位置。
 * 仅作用于显示层——不影响 rawTrail/smoothedTrail 数据、有效移动计分、
 * InputManager 协议或 SwordEngine 规则；无位置预测。
 */
export function applyDisplayDeadZone(
  prev: { x: number; y: number } | null,
  next: { x: number; y: number },
  thresholdPx: number = DISPLAY_DEAD_ZONE_PX,
): { x: number; y: number } {
  if (prev === null) return next;
  if (Math.hypot(next.x - prev.x, next.y - prev.y) < thresholdPx) return prev;
  return next;
}

export class TrailRenderer {
  render(ctx: CanvasRenderingContext2D, input: TrailRenderInput): void {
    const { rawTrail, smoothedTrail, showRaw, showSmooth, swordTip, now, trailTtlMs } = input;

    if (showSmooth && smoothedTrail.length > 1) {
      this.drawTrail(ctx, smoothedTrail, now, trailTtlMs, {
        color: TRAIL_COLORS.smooth,
        width: 2.2,
        dash: null,
        glow: 'rgba(205, 239, 232, 0.45)',
        baseAlpha: 0.92,
      });
    }
    if (showRaw && rawTrail.length > 1) {
      this.drawTrail(ctx, rawTrail, now, trailTtlMs, {
        color: TRAIL_COLORS.raw,
        width: 1,
        dash: [2, 7],
        glow: null,
        baseAlpha: 0.8,
      });
    }
    if (swordTip) {
      this.drawSwordTip(ctx, swordTip);
    }
  }

  private drawTrail(
    ctx: CanvasRenderingContext2D,
    trail: TrailPoint[],
    now: number,
    ttl: number,
    style: {
      color: string;
      width: number;
      dash: number[] | null;
      glow: string | null;
      baseAlpha: number;
    },
  ): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    if (style.dash) ctx.setLineDash(style.dash);
    if (style.glow) {
      ctx.shadowColor = style.glow;
      ctx.shadowBlur = 6;
    }
    for (let i = 1; i < trail.length; i++) {
      // 仅绘制 ACTIVE 段：收势（SHEATHED）后剑痕停止绘制；长时间断点不连线
      if (trail[i].a !== 'ACTIVE' || trail[i - 1].a !== 'ACTIVE') continue;
      if (trail[i].t - trail[i - 1].t > 350) continue;
      const age = now - trail[i].t;
      const alpha = Math.max(0, 1 - age / ttl);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha * style.baseAlpha;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSwordTip(ctx: CanvasRenderingContext2D, tip: { x: number; y: number }): void {
    ctx.save();
    ctx.shadowColor = 'rgba(205, 239, 232, 0.8)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = TRAIL_COLORS.smooth;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(205, 239, 232, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

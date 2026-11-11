/**
 * 第四阶段遗留补足：招式对应短暂弹出提示（toast 层）。
 * - 纯展示组件：完全由 CombatSnapshot.technique.attempt（含 createdAt/expiresAt）驱动；
 * - React 不新建 setTimeout、不按渲染帧制造事件，过期由 attempt 自身 TTL 判定自动隐藏；
 * - 同一 segmentId 只弹一次（App 层用 useRef 记录已展示 id）；
 * - 有效命中=暖金、未命中=青白、失败=朱红，克制无发光。
 */
import { cn } from '@/lib/utils';

/** 供测试与 App 共用的 attempt 形状（与 techniqueEngine 输出一致） */
export interface TechniqueAttemptLike {
  kind: string;
  status: 'effective' | 'miss' | 'failed';
  segmentId: number;
  text: string;
  createdAt: number;
  expiresAt: number;
}

/** toast 展示时长（ms）：1.2~1.6s 克制区间，取 1.4s */
export const TOAST_TTL_MS = 1400;

export interface TechniqueToastData {
  segmentId: number;
  text: string;
  tone: 'effective' | 'miss' | 'failed';
}

/**
 * 由 attempt 快照派生当前应显示的 toast（纯函数，无副作用、无计时器）。
 * 返回 null 表示不显示（无 attempt / 已过期）。
 * App 层负责 segmentId 去重：仅当 segmentId 与上次已展示的不同时更新。
 */
export function deriveTechniqueToast(
  attempt: TechniqueAttemptLike | null | undefined,
  nowMs: number,
): TechniqueToastData | null {
  if (!attempt) return null;
  if (attempt.expiresAt <= attempt.createdAt) return null; // 数据异常：不显示
  const age = nowMs - attempt.createdAt;
  if (age < 0 || age > TOAST_TTL_MS) return null; // 过期自动隐藏（由 snapshot 时间驱动）
  // 状态→语气映射（容错：未知名按 miss 处理不崩溃）
  const tone =
    attempt.status === 'effective' ? 'effective' : attempt.status === 'failed' ? 'failed' : 'miss';
  return { segmentId: attempt.segmentId, text: attempt.text, tone };
}

/** toast 颜色（克制的国风配色：暖金 / 青白 / 朱红） */
const TONE_CLASS: Record<TechniqueToastData['tone'], string> = {
  effective: 'border-[hsl(var(--gold))]/50 text-[hsl(var(--gold))]',
  miss: 'border-[#cdefe8]/40 text-[#cdefe8]',
  failed: 'border-[#c07a5e]/50 text-[#c07a5e]',
};

/**
 * 招式提示 toast：舞台上方居中、轻量非阻塞、pointer-events-none。
 * 淡入淡出由 attempt 剩余寿命计算（opacity 阶梯，不做大面积遮罩）。
 */
export function TechniqueToast({ toast }: { toast: TechniqueToastData | null }) {
  if (!toast) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-10 z-20 flex justify-center"
      aria-live="polite"
      role="status"
    >
      <div
        className={cn(
          'rounded-md border bg-[hsl(var(--arena-bg))]/85 px-4 py-1.5 text-sm tracking-wide backdrop-blur-[2px]',
          TONE_CLASS[toast.tone],
        )}
      >
        {toast.text}
      </div>
    </div>
  );
}
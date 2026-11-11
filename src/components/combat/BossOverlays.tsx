/**
 * 第九阶段：赤瞳山魈 Boss 战浮层（开始 / 失败重试 / 胜利结算）。
 * - 纯展示 + 回调：状态权威在 CombatEngine/LifeEngine；
 * - 胜利按钮只出现一次（phase==='won' 且 Life 已接收 victory 后由 App 换成结算面板）；
 * - 国风克制：印章式文字 + 亮金按钮，无粒子、无满屏数字。
 */
import { Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CombatPhase } from '@/combat/combatEngine';
import { PORTRAITS } from '@/combat/portraits';

export function BossOverlays({
  phase,
  onStart,
  onRetry,
}: {
  phase: CombatPhase;
  onStart: () => void;
  onRetry: () => void;
}) {
  if (phase === 'fighting') return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(3,7,9,.68)] p-4 backdrop-blur-[2px]">
      {phase === 'idle' && (
        <div data-ui-interactive className="scroll-ink anim-unfurl pointer-events-auto relative flex w-full max-w-xl flex-col items-center gap-4 overflow-hidden rounded-md px-8 py-8 text-center">
          <div className="scroll-rod absolute inset-x-[-8px] top-0" />
          <img src={PORTRAITS.chitongshanxiao} alt="" className="pointer-events-none absolute -bottom-28 -right-8 h-[135%] opacity-20 grayscale" />
          <div className="seal-mark anim-seal flex size-20 items-center justify-center rounded-md px-2 text-center text-lg leading-tight">
            赤瞳<br />山魈
          </div>
          <p className="text-sm text-[hsl(var(--gold))]">两剑已定 · 山魈挡在第一夜之前</p>
          <p className="text-xs leading-5 text-[hsl(var(--gold))]/80">
            试剑可收势格挡 · 破势以剑穿其目 · 乱战三式正其时
          </p>
          <Button
            variant="arena"
            className="relative border-[hsl(var(--gold))]/40 text-[hsl(var(--gold))]"
            onClick={onStart}
          >
            <Play /> 出剑迎魈
          </Button>
          <div className="scroll-rod absolute inset-x-[-8px] bottom-0" />
        </div>
      )}
      {phase === 'lost' && (
        <div data-ui-interactive className="scroll-ink anim-unfurl pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-md p-7">
          <div className="flex flex-col items-center gap-2">
            <div className="ink-seal flex size-20 rotate-[-4deg] items-center justify-center rounded-md px-2 text-center text-lg leading-tight">
              剑心<br />受挫
            </div>
            <p className="text-sm text-[#c07a5e]">护体真气已尽 · 山魈未退</p>
          </div>
          <Button
            variant="arena"
            className="border-[hsl(var(--gold))]/40 text-[hsl(var(--gold))]"
            onClick={onRetry}
          >
            <RotateCcw /> 重新试炼
          </Button>
        </div>
      )}
      {/* won：结算面板由 LifeOverlay（CHAPTER_RESULT）渲染，此处不放第二个按钮 */}
      {phase === 'won' && null}
    </div>
  );
}

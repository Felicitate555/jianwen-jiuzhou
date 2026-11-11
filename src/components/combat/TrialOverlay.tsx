/**
 * 试炼结算浮层：开始入口 / 试炼通过 / 剑心破碎。
 * 国风克制：印章式文字 + 单按钮，无金光粒子。
 */
import { Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CombatPhase } from '@/combat/combatEngine';
import { PORTRAITS } from '@/combat/portraits';

export function TrialOverlay({
  phase,
  onStart,
}: {
  phase: CombatPhase;
  onStart: () => void;
}) {
  if (phase === 'fighting') return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(3,8,10,.56)] p-4 backdrop-blur-[1px]">
      {phase === 'idle' && (
        <div data-ui-interactive className="scroll-ink anim-unfurl pointer-events-auto relative flex min-h-[min(70vh,620px)] w-full max-w-5xl flex-col items-center justify-center gap-5 overflow-hidden rounded-md px-8 py-10 text-center md:items-start md:px-14 md:text-left">
          <div className="scroll-rod absolute inset-x-[-8px] top-0" />
          <img src={PORTRAITS.shanlang} alt="" className="pointer-events-none absolute -bottom-[20%] -right-[4%] h-[125%] opacity-25 grayscale md:opacity-55" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#071012] via-[#071012]/80 to-transparent" />
          <p className="relative font-display text-3xl tracking-[.3em] text-[#e9decb] md:text-5xl">雾岭试剑</p>
          <p className="relative max-w-lg text-base leading-7 text-[hsl(var(--gold))] md:text-lg">
            山狼将至 · 出剑斩之，握拳收势以护其扑击
          </p>
          <p className="relative max-w-lg text-sm leading-6 text-[hsl(var(--gold))]/75">
            狼后妖修现身 · 蓄力露心可破势，妖气弹以剑痕斩之
          </p>
          <Button className="relative mt-2 min-w-40"
            variant="arena"
            onClick={onStart}
          >
            <Play /> 开始试炼
          </Button>
          <div className="scroll-rod absolute inset-x-[-8px] bottom-0" />
        </div>
      )}
      {phase === 'won' && (
        <div data-ui-interactive className="scroll-ink anim-unfurl pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-md p-7">
          <div className="ink-seal flex size-20 rotate-[-3deg] items-center justify-center rounded-md px-2 text-center text-lg leading-tight">
            试炼<br />通过
          </div>
          <Button
            variant="arena"
            className="border-[hsl(var(--gold))]/40 text-[hsl(var(--gold))]"
            onClick={onStart}
          >
            <RotateCcw /> 再战一局
          </Button>
        </div>
      )}
      {phase === 'lost' && (
        <div data-ui-interactive className="scroll-ink anim-unfurl pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-md p-7">
          <div className="flex flex-col items-center gap-2">
            <div className="ink-seal flex size-20 rotate-[-4deg] items-center justify-center rounded-md px-2 text-center text-lg leading-tight">
              剑心<br />破碎
            </div>
            <p className="text-sm text-[#c07a5e]">护体真气已尽</p>
          </div>
          <Button
            variant="arena"
            className="border-[hsl(var(--gold))]/40 text-[hsl(var(--gold))]"
            onClick={onStart}
          >
            <RotateCcw /> 重新试炼
          </Button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TECHNIQUE_CONFIG } from '@/technique/techniqueConfig';
import type { CombatSnapshot } from '@/combat/combatEngine';
import { cn } from '@/lib/utils';

type TechniqueKey = 'diagonalSlash' | 'cross' | 'returnWind';
const ORDER: TechniqueKey[] = ['diagonalSlash', 'cross', 'returnWind'];
const KIND: Record<TechniqueKey, 'DIAGONAL_SLASH' | 'CROSS' | 'RETURN_WIND'> = {
  diagonalSlash: 'DIAGONAL_SLASH', cross: 'CROSS', returnWind: 'RETURN_WIND',
};

function QiBar({ label, value, max, tone, dim }: { label: string; value: number; max: number; tone: 'guard' | 'qi'; dim?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('w-40 md:w-52', dim && 'opacity-55')}>
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <span className="text-[10px] tracking-[.28em] text-[#d9eee8]/70">{label}</span>
        <span className={cn('font-mono text-[10px] tabular-nums', tone === 'guard' ? 'text-[#e1b66e]/80' : 'text-[#a8dfd0]/80')}>{Math.round(value)}</span>
      </div>
      <div className={cn('h-[5px] overflow-hidden rounded-full border bg-black/35', tone === 'guard' ? 'border-[#d9a45b]/25' : 'border-[#9fd8c8]/20')} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${pct}%`, background: tone === 'guard' ? 'linear-gradient(90deg,#715632,#d9a45b,#f0d598)' : 'linear-gradient(90deg,#356b61,#9fd8c8,#d4f4eb)', boxShadow: tone === 'guard' ? '0 0 8px #d9a45b66' : '0 0 8px #9fd8c866' }} />
      </div>
    </div>
  );
}

function FloatingPrompt({ snapshot }: { snapshot: CombatSnapshot }) {
  const lastId = useRef<number | null>(null);
  const [shown, setShown] = useState<{ id: number; text: string; kind: string } | null>(null);
  const latest = snapshot.prompts.at(-1) ?? null;
  useEffect(() => {
    if (latest && latest.id !== lastId.current) { lastId.current = latest.id; setShown(latest); }
  }, [latest]);
  if (!shown) return null;
  return <p key={shown.id} className={cn('anim-prompt mt-2 text-xs', shown.kind === 'good' ? 'text-[#a9e1d1]' : shown.kind === 'warn' ? 'text-[#d98b72]' : 'text-[#d9eee8]/65')} aria-live="polite">{shown.text}</p>;
}

export function StageHud({ snapshot, now }: { snapshot: CombatSnapshot; now: number }) {
  const boss = snapshot.boss;
  const bossPct = boss ? Math.max(0, Math.min(100, boss.hp / boss.hpMax * 100)) : 0;
  const rangedAlive = snapshot.rangedEnemy && snapshot.rangedEnemy.state !== 'DEAD' && snapshot.rangedEnemy.state !== 'DYING';
  const wolfAlive = snapshot.wolf.state !== 'DEAD' && snapshot.wolf.state !== 'DYING';
  const ordinaryEnemy = rangedAlive
    ? { name: '雾岭妖修', hp: snapshot.rangedEnemy!.hp, max: snapshot.rangedEnemy!.hpMax }
    : wolfAlive ? { name: '山狼', hp: snapshot.wolf.hp, max: snapshot.wolf.hpMax } : null;
  const learned = ORDER.filter(key => snapshot.technique.learned[key]);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="hud-panel absolute left-3 top-3 rounded-sm px-3 py-2.5 md:left-5 md:top-5">
        <QiBar label="护体真气" value={snapshot.guardQi} max={snapshot.guardQiMax} tone="guard" />
        <div className="mt-2.5"><QiBar label="气机" value={snapshot.qi} max={snapshot.qiMax} tone="qi" dim={snapshot.exhausted} /></div>
        <FloatingPrompt snapshot={snapshot} />
      </div>
      {boss && boss.state !== 'DEAD' && (
        <div className="absolute inset-x-0 top-3 flex flex-col items-center md:top-4">
          <h2 className="font-display text-base tracking-[.5em] text-[#eadfd1] [text-shadow:0_0_15px_rgba(194,64,58,.55)] md:text-xl">赤瞳山魈</h2>
          <div className="mt-1.5 h-[7px] w-56 overflow-hidden rounded-full border border-[#c2404a]/45 bg-black/55 md:w-80" role="progressbar" aria-label="山魈血气" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bossPct)}>
            <div className={cn('h-full transition-[width] duration-150', bossPct <= 25 && 'animate-pulse')} style={{ width: `${bossPct}%`, background: 'linear-gradient(90deg,#5d2028,#a83945,#dd6270)', boxShadow: '0 0 10px #c2404a88' }} />
          </div>
          {boss.ranged.state === 'CHARGE' && boss.weakPointActive && <p className="mt-1 text-[11px] tracking-[.2em] text-[#dc8c73]">蓄力 · 剑穿其目可破势</p>}
          {snapshot.projectiles.length > 0 && <p className="mt-1 text-[11px] tracking-[.2em] text-[#dc8c73]">妖气弹来袭 · 挥剑斩之</p>}
        </div>
      )}
      {!boss && ordinaryEnemy && snapshot.phase === 'fighting' && (
        <div className="absolute inset-x-0 top-4 flex flex-col items-center">
          <span className="text-[11px] tracking-[.3em] text-[#dce9e4]/65">{ordinaryEnemy.name}</span>
          <div className="mt-1 h-[4px] w-36 overflow-hidden rounded-full bg-black/45"><div className="h-full bg-gradient-to-r from-[#72363a] to-[#bd5b60] transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, ordinaryEnemy.hp / ordinaryEnemy.max * 100))}%` }} /></div>
        </div>
      )}
      {learned.length > 0 && snapshot.phase === 'fighting' && !snapshot.choiceGate && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="flex items-end gap-2"><span className="mb-1 text-[10px] tracking-[.28em] text-[#cdefe8]/40">已掌握剑式</span>{learned.map(key => {
            const last = snapshot.technique.last;
            const onCd = last?.kind === KIND[key] && now - last.recognizedAt < DEFAULT_TECHNIQUE_CONFIG[key].cooldownMs;
            return <span key={key} className={cn('technique-chip px-2.5 py-1 text-xs tracking-[.18em]', onCd ? 'text-[#9ab4a8]/35' : 'text-[#dcf5ee]')}>{DEFAULT_TECHNIQUE_CONFIG[key].name}</span>;
          })}</div>
        </div>
      )}
    </div>
  );
}

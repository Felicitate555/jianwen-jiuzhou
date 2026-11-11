/**
 * 第九阶段：赤瞳山魈 Boss HUD（阶段/预警/护体真气/气机）。
 * 只读 snapshot；战斗权威在 CombatEngine。克制视觉：状态条 + 一行阶段文案。
 */
import { cn } from '@/lib/utils';
import { BOSS_PHASE_LEAD, BOSS_PHASE_TEXT } from '@/combat/bossEncounter';
import type { CombatSnapshot } from '@/combat/combatEngine';

function BossBar({ label, value, max, tone, dim }: { label: string; value: number; max: number; tone: 'boss' | 'guard' | 'qi'; dim?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const toneCls = tone === 'boss' ? 'bg-[#8a4a42]' : tone === 'guard' ? 'bg-[#d9a45b]' : 'bg-[#8fb8ac]';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className={cn('text-xs', dim ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{label}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground/80">
          {Math.round(value)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted/70"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-150', toneCls)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const RANGED_HINT: Record<string, string> = {
  ENTER: '现身',
  CHARGE: '蓄力 · 可破势',
  FIRE: '释放',
  RECOVER: '恢复',
  INTERRUPTED: '已破势',
};

export function BossHud({ snapshot }: { snapshot: CombatSnapshot }) {
  const boss = snapshot.boss;
  if (!boss) return null;
  const dying = boss.state === 'DYING' || boss.state === 'DEAD';
  const charging = boss.ranged.state === 'CHARGE' && boss.weakPointActive;
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="山魈战况">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          终局 · 赤瞳山魈
        </h2>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs',
            dying ? 'border-border text-muted-foreground/70' : 'border-[#c07a5e]/50 text-[#c07a5e]',
          )}
        >
          {dying ? '伏诛' : `${BOSS_PHASE_TEXT[boss.phase]}`}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        <BossBar label="山魈血气" value={boss.hp} max={boss.hpMax} tone="boss" />
        <BossBar label="护体真气" value={snapshot.guardQi} max={snapshot.guardQiMax} tone="guard" />
        <BossBar label="气机" value={snapshot.qi} max={snapshot.qiMax} tone="qi" dim={snapshot.exhausted} />
      </div>
      <p
        className={cn(
          'mt-2 text-xs leading-5',
          charging ? 'text-[#c07a5e]' : 'text-muted-foreground',
        )}
        aria-live="polite"
      >
        {!dying && BOSS_PHASE_LEAD[boss.phase]}
        {charging ? ' —— 蓄力中 · 剑穿其目可破势' : ''}
      </p>
      {snapshot.projectiles.length > 0 && (
        <p className="text-xs leading-5 text-[#c07a5e]">妖气弹来袭 · 挥剑斩之</p>
      )}
      {/* Boss 战同样显示三式状态（复用既有剑招区结构由 TrialHud 处理；此处只显示招式反馈一行） */}
      {snapshot.technique.attempt && (
        <p
          className={cn(
            'mt-2 text-sm leading-6',
            snapshot.technique.attempt.status === 'effective' && 'text-[#8fb8ac]',
            snapshot.technique.attempt.status === 'miss' && 'text-muted-foreground',
            snapshot.technique.attempt.status === 'failed' && 'text-[#c07a5e]',
          )}
        >
          {snapshot.technique.attempt.text}
        </p>
      )}
      {boss.ranged.state in RANGED_HINT && (
        <p className="mt-1 text-xs text-muted-foreground/80">
          山魈 · {RANGED_HINT[boss.ranged.state]}
        </p>
      )}
    </section>
  );
}
/**
 * 试炼 HUD：护体真气、气机、山狼生命与临时提示。
 * 克制视觉：无满屏数字，状态条为主，文字提示短暂浮现。
 */
import { cn } from '@/lib/utils';
import type { CombatSnapshot } from '@/combat/combatEngine';

interface BarProps {
  label: string;
  value: number;
  max: number;
  tone: 'guard' | 'qi' | 'wolf';
  dim?: boolean;
}

const TONE_CLASS: Record<BarProps['tone'], string> = {
  guard: 'bg-[#d9a45b]',
  qi: 'bg-[#8fb8ac]',
  wolf: 'bg-[#8a4a42]',
};

function Bar({ label, value, max, tone, dim }: BarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className={cn('text-xs', dim ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
          {label}
        </span>
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
          className={cn('h-full rounded-full transition-[width] duration-150', TONE_CLASS[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** 远程敌人状态文字（HUD 短标签） */
const RANGED_STATE_TEXT: Record<string, string> = {
  ENTER: '现身',
  CHARGE: '蓄力 · 可破势',
  FIRE: '释放',
  RECOVER: '恢复',
  INTERRUPTED: '已破势',
  DYING: '消散',
  DEAD: '已除',
};

/**
 * 妖修 DEAD/DYING 分支区分：
 * - 三轮耗尽退场（cycles ≥ maxCycles）：非玩家击杀，显示「退场」；
 * - 其余为玩家击杀（HP 归零），保留「已除/消散」反馈。
 */
function rangedEndText(ranged: NonNullable<CombatSnapshot['rangedEnemy']>, state: string): string {
  const exhausted = ranged.cycles >= ranged.maxCycles;
  if (state === 'DEAD') return exhausted ? '退场' : RANGED_STATE_TEXT.DEAD;
  if (state === 'DYING') return exhausted ? '退场中' : RANGED_STATE_TEXT.DYING;
  return RANGED_STATE_TEXT[state] ?? state;
}

export function TrialHud({ snapshot }: { snapshot: CombatSnapshot }) {
  const { wolf } = snapshot;
  const wolfAlive = wolf.state !== 'DEAD' && wolf.state !== 'DYING';
  const ranged = snapshot.rangedEnemy;
  const rangedAlive = ranged !== null && ranged.state !== 'DEAD' && ranged.state !== 'DYING';
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">试炼状态</h2>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs',
            snapshot.sheathed
              ? 'border-accent/50 text-accent'
              : 'border-border text-muted-foreground',
          )}
        >
          {snapshot.sheathed ? '收势 · 回气' : '出剑'}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        <Bar label="护体真气" value={snapshot.guardQi} max={snapshot.guardQiMax} tone="guard" />
        <Bar
          label="气机"
          value={snapshot.qi}
          max={snapshot.qiMax}
          tone="qi"
          dim={snapshot.exhausted}
        />
        <Bar label="山狼" value={wolf.hp} max={wolf.hpMax} tone="wolf" dim={!wolfAlive} />
        {ranged && (
          <>
            <Bar
              label="妖修"
              value={ranged.hp}
              max={ranged.hpMax}
              tone="wolf"
              dim={!rangedAlive}
            />
            <p
              className={cn(
                'text-xs leading-5',
                ranged.state === 'CHARGE' && ranged.weakPointActive && 'text-[#c07a5e]',
                ranged.state === 'INTERRUPTED' && 'text-[#8fb8ac]',
              )}
            >
              妖修 · {rangedEndText(ranged, ranged.state)}
              {ranged.state === 'CHARGE' && ranged.weakPointActive ? ' —— 剑穿其心' : ''}
            </p>
          </>
        )}
        {snapshot.projectiles.length > 0 && (
          <p className="text-xs leading-5 text-[#c07a5e]">妖气弹来袭 · 挥剑斩之</p>
        )}
      </div>

      {/* 剑招区：第四阶段三式基础剑招，会话内可练/可领悟（无随机锁） */}
      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">剑招 · 三式基础</h3>
          {snapshot.technique.last && !snapshot.technique.attempt && (
            <span className="text-xs text-[#8fb8ac]">{snapshot.technique.last.feedback}</span>
          )}
        </div>
        {/* 招式反馈（一行）：已识别未命中 / 已生效 / 招式未成 —— 真实分类与战斗状态 */}
        {snapshot.technique.attempt && (
          <p
            className={cn(
              'mt-2 text-sm leading-6',
              snapshot.technique.attempt.status === 'effective' && 'text-[#8fb8ac]',
              snapshot.technique.attempt.status === 'miss' && 'text-muted-foreground',
              snapshot.technique.attempt.status === 'failed' && 'text-[#c07a5e]',
            )}
            aria-live="polite"
          >
            {snapshot.technique.attempt.text}
          </p>
        )}
        <ul className="mt-2 space-y-1.5" aria-label="剑招领悟状态">
          <li className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'text-xs',
                snapshot.technique.learned.diagonalSlash ? 'text-[#8fb8ac]' : 'text-muted-foreground',
              )}
            >
              斜劈 · 一笔对角
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                snapshot.technique.learned.diagonalSlash
                  ? 'border-[#8fb8ac]/50 text-[#8fb8ac]'
                  : 'border-border text-muted-foreground/70',
              )}
            >
              {snapshot.technique.learned.diagonalSlash ? '已领悟' : '可领悟'}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'text-xs',
                snapshot.technique.learned.cross ? 'text-[#8fb8ac]' : 'text-muted-foreground',
              )}
            >
              十字剑 · 两笔交叉
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                snapshot.technique.learned.cross
                  ? 'border-[#8fb8ac]/50 text-[#8fb8ac]'
                  : 'border-border text-muted-foreground/70',
              )}
            >
              {snapshot.technique.learned.cross ? '已领悟' : '可领悟'}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'text-xs',
                snapshot.technique.learned.returnWind ? 'text-[#8fb8ac]' : 'text-muted-foreground',
              )}
            >
              回风式 · 弧形回转
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                snapshot.technique.learned.returnWind
                  ? 'border-[#8fb8ac]/50 text-[#8fb8ac]'
                  : 'border-border text-muted-foreground/70',
              )}
            >
              {snapshot.technique.learned.returnWind ? '已领悟' : '可领悟'}
            </span>
          </li>
        </ul>
      </div>

      {/* 临时提示区：收势/气机不继/剑势失控/快准稳，短暂显示 */}
      <div className="mt-3 min-h-16 space-y-1.5" aria-live="polite">
        {snapshot.prompts.slice(-3).map((p) => (
          <p
            key={p.id}
            className={cn(
              'text-xs leading-5',
              p.kind === 'good' && 'text-[#8fb8ac]',
              p.kind === 'warn' && 'text-[#c07a5e]',
              p.kind === 'info' && 'text-muted-foreground',
            )}
          >
            {p.text}
          </p>
        ))}
      </div>

      {snapshot.lastStrike && (
        <p className="mt-1 border-t border-border/60 pt-2 font-mono text-xs tabular-nums text-muted-foreground">
          上一剑{snapshot.lastStrike.technique ? ` · ${snapshot.lastStrike.technique}` : ''} · 速{' '}
          {snapshot.lastStrike.speedScore} / 准 {snapshot.lastStrike.accuracyScore} / 稳{' '}
          {snapshot.lastStrike.stabilityScore}
        </p>
      )}
    </section>
  );
}
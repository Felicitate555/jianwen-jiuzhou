/**
 * 第五阶段 React 集成层：人生开局/第一章选择/结算/九州边界的舞台浮层。
 * - 纯展示 + 事件回调：状态权威在 LifeEngine（App 持有），本组件不持有业务状态；
 * - 上半屏选择内容、下半屏御剑区域照常可用（本层只占上半屏，choiceGate 由 App 控制）；
 * - 亮金文字使用 hsl(var(--gold))（有效 token），按钮/focus/disabled 均可读。
 */
import { ArrowRight, BookOpenCheck, Feather, RotateCcw, ScrollText, Swords, Users } from 'lucide-react';
import { Children, isValidElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  ChoiceEvent,
  CompanionState,
  Constitution,
  LifeProfile,
  LifeState,
  Origin,
} from '@/life/lifeTypes';
import { COMPANION } from '@/life/lifeConfig';
import { InkPending } from '@/components/life/InkPending';

const gold = 'text-[hsl(var(--gold))]';

/** 克制的导演来源标记（章回信息区小字：AI导演 / 固定导演 / 落字中） */
function DirectorBadge({
  loading,
  source,
  fallbackReason,
}: {
  loading: boolean;
  source: 'ai' | 'deterministic' | null;
  fallbackReason?: string | null;
}) {
  if (loading) {
    return <InkPending compact />;
  }
  if (source === 'ai') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] leading-4 text-[hsl(var(--gold))]/55">
        <Feather className="size-3" />
        本段叙事 · AI导演
      </span>
    );
  }
  if (source === 'deterministic') {
    const reasonMap: Record<string, string> = {
      unconfigured: 'AI 服务未配置 · 本段由固定导演续写',
      timeout: '本段叙事 · 固定导演（超时降级）',
      network: '本段叙事 · 固定导演（网络降级）',
      http: '本段叙事 · 固定导演（服务异常）',
      empty: '本段叙事 · 固定导演（空响应）',
      'invalid-schema': '本段叙事 · 固定导演（格式异常）',
    };
    const label = reasonMap[fallbackReason ?? ''] ?? '本段叙事 · 固定导演';
    return (
      <span className="inline-flex items-center gap-1 text-[10px] leading-4 text-[#cdefe8]/40">
        <Feather className="size-3" />
        {label}
      </span>
    );
  }
  return null;
}

export interface LifeOverlayProps {
  state: LifeState;
  /** 身份卡数据 */
  profile: LifeProfile | null;
  origin: Origin | undefined;
  constitution: Constitution | undefined;
  /** 选择事件（choice 阶段） */
  event: ChoiceEvent | null;
  /** 已选候选 id */
  pendingChoiceId: string | null;
  /** 同行者事件文案 */
  companionText: { title: string; text: string } | null;
  /** 第一章结算 */
  chapterResult: { title: string; lines: string[] } | null;
  /** 章回开场 */
  opening: { title: string; text: string } | null;
  /** 九州边界文案 */
  journey: { title: string; text: string } | null;
  /** 剑意感应进度（0~1；SENSING_GATE 阶段实时显示） */
  sensingProgress: number;
  /** 剑道机缘（TECHNIQUE_GATE 当前式教学 + 已领悟列表） */
  techniqueEvent: {
    name: string;
    source: string;
    teachingText: string;
    practiceHint: string;
    learnedNames: string[];
    /** 传承叙事是否已落定（NARRATIVE_READY 才可练习成招） */
    ready: boolean;
    body: string | null;
    /** v33 阶段机：LOCKED/OPPORTUNITY_AVAILABLE/MANUAL_RECEIVED/LEARNING/MASTERED */
    stage: 'LOCKED' | 'OPPORTUNITY_AVAILABLE' | 'MANUAL_RECEIVED' | 'LEARNING' | 'MASTERED';
    /** 练习成功进度（已成功次数 / 所需次数） */
    practiceProgress: { done: number; required: number };
    kind: 'diagonalSlash' | 'cross' | 'returnWind';
  } | null;
  /** 交互回调（全部由 App 转发 LifeEngine） */
  onSelectGender: (g: 'male' | 'female') => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onConfirmProfile: () => void;
  /** v33 三式阶段机：确认看到卷轴/教学（OPPORTUNITY_AVAILABLE → MANUAL_RECEIVED） */
  onAcknowledgeManual: () => void;
  onSelectOption: (id: string) => void;
  onContinueChoice?: () => void;
  onRespondCompanion: (r: 'warm' | 'reserved' | 'skip') => void;
  onEnterJourney: () => void;
  /** 重新历练本章（重放人生第一章；区别于战斗区域的「重新试炼」） */
  onReplayChapter: () => void;
  /** AI 叙事状态：加载中 / 来源标记（克制展示，不做巨大标签） */
  aiLoading: boolean;
  aiSource: 'ai' | 'deterministic' | null;
  /** 降级原因（与实际 source 一致：timeout/network/http/empty/invalid-schema） */
  aiFallbackReason: string | null;
  /** 身份卡 AI 引言（PROFILE_REVIEW；身份事实仍来自引擎） */
  identityNarrative: string | null;
  /** 继续人生/新开一局（存在档时首屏） */
  onContinue: () => void;
  onNewLife: () => void;
  /** 存在可继续的档案（影响首屏展示） */
  hasSave: boolean;
  /** 存档损坏提示（回退新局时一次性显示） */
  saveNotice: string | null;
  /** 打开命簿（长期人生档案查看；纯 UI 状态切换，不触发任何请求） */
  onOpenLedger: () => void;
  /** 确认剑提示（choice 阶段：未出剑时显示） */
  confirmHint: 'idle' | 'await-stroke' | 'sheathed';
}

/** 上半屏浮层容器：不遮下半屏御剑区；choice 阶段特别收窄 */
function hasAction(child: ReactNode): boolean {
  if (!isValidElement<{ children?: ReactNode; onClick?: unknown }>(child)) return false;
  return Boolean(child.props.onClick) || Children.toArray(child.props.children).some(hasAction);
}

function UpperPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  const parts = Children.toArray(children);
  const actions = parts.filter(hasAction);
  const content = parts.filter((part) => !hasAction(part));
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-20 flex max-h-full justify-center p-3',
        className,
      )}
    >
      <div data-ui-interactive className="scroll-ink anim-unfurl life-panel pointer-events-auto flex min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-md">
        <div className="scroll-rod mx-[-2px] shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{content}</div>
        {actions.length > 0 && <div className="max-h-[65%] shrink-0 overflow-y-auto border-t border-[#cdefe8]/10 px-5 py-3">{actions}</div>}
        <div className="scroll-rod mx-[-2px] shrink-0" />
      </div>
    </div>
  );
}

export function LifeOverlay(props: LifeOverlayProps) {
  const { state } = props;
  const phase = state.phase;

  // —— 第一步：性别（仅此一项，不出现身份）——
  if (phase === 'PROFILE_GENDER') {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-[hsl(var(--arena-bg))]/75 backdrop-blur-[2px]">
        <UpperPanel>
          <h2 className={cn('font-display text-lg', gold)}>剑修人生 · 第一步</h2>
          <p className="mt-2 text-sm leading-6 text-[#cdefe8]/85">
            雾岭之下，一切从一柄剑开始。先择你的模样。
          </p>
          {props.hasSave && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button variant="arena" className="flex-1" onClick={props.onContinue}>
                <ArrowRight /> 继续人生
              </Button>
              <Button variant="arena" className="flex-1" onClick={props.onNewLife}>
                新开一局
              </Button>
            </div>
          )}
          {props.saveNotice && (
            <p className="mt-2 text-xs leading-5 text-[#c07a5e]">{props.saveNotice}</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="arena" onClick={() => props.onSelectGender('male')}>
              男 · 携剑入雾
            </Button>
            <Button variant="arena" onClick={() => props.onSelectGender('female')}>
              女 · 携剑入雾
            </Button>
          </div>
          <p className="mt-2 text-xs text-[#cdefe8]/50">
            性别只决定身份生成的样子，不决定剑路的强弱。
          </p>
        </UpperPanel>
      </div>
    );
  }

  if (phase === 'PROFILE_GENERATING') {
    return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>命盘推演中…</h2>
        <p className="mt-2 text-sm text-[#cdefe8]/80">已择性别，推演本局姓名、出身与体质。</p>
        <Button variant="arena" className="mt-3" onClick={props.onGenerate}>
          推演本局身份
        </Button>
      </UpperPanel>
    );
  }

  if (phase === 'PROFILE_REVIEW' && props.profile) {
    const cons = props.constitution;
    return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>本局剑修 · {props.profile.name}</h2>
        <dl className="mt-3 space-y-2 text-sm leading-6 text-[#cdefe8]/85">
          <div>
            <dt className="text-xs text-[#cdefe8]/55">出身</dt>
            <dd>
              {props.origin?.title ?? '未知之地'} —— {props.origin?.text ?? ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#cdefe8]/55">残缺体质</dt>
            <dd>
              <span className={gold}>{cons?.title ?? '未知'}</span>
              <span className="ml-2 inline-flex gap-1 align-middle">
                {(cons?.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-[hsl(var(--gold))]/30 px-2 py-0.5 text-[10px] text-[#cdefe8]/70"
                  >
                    {t}
                  </span>
                ))}
              </span>
            </dd>
            <dd className="text-[#cdefe8]/70">{cons?.text}</dd>
            <dd className="mt-1 text-xs text-[#cdefe8]/55">
              体质是开局之异，不是人人共有的秘密。它{cons?.repairable ? '可被机缘修补' : '难以修补'}
              {cons?.transformable ? '，亦可化为剑路根基' : ''}——
              倾向：{(cons?.pathTags ?? []).join(' / ')}。此生如何走，仍看你的剑。
            </dd>
          </div>
        </dl>
        {props.identityNarrative && (
          <p className="mt-3 whitespace-pre-line border-l-2 border-[hsl(var(--gold))]/30 pl-3 text-sm leading-6 text-[#cdefe8]/85">
            {props.identityNarrative}
          </p>
        )}
        <div className="mt-3 flex min-h-4 items-center">
          <DirectorBadge loading={props.aiLoading} source={props.aiSource} fallbackReason={props.aiFallbackReason} />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="arena"
            className="flex-1"
            onClick={props.onConfirmProfile}
            disabled={props.aiLoading || state.activeEvent?.phase !== 'NARRATIVE_READY'}
            title={props.aiLoading ? '剑意落字中 · 落定后方可入第一章' : undefined}
          >
            {props.aiLoading ? '剑意落字中……' : '便是我了 · 入第一章'}
          </Button>
          <Button
            variant="arena"
            className="flex-1"
            onClick={props.onRegenerate}
            disabled={props.aiLoading || state.activeEvent?.phase !== 'NARRATIVE_READY'}
            title={props.aiLoading ? '剑意落字中 · 落定后方可重铸命盘' : undefined}
          >
            重新生成本局身份
          </Button>
        </div>
        {props.aiLoading && (
          <p className="mt-1.5 text-[10px] leading-4 text-[#cdefe8]/45">
            身份正文未落定 · 不可确认、不可重生成、不可提前入章
          </p>
        )}
      </UpperPanel>
    );
  }

  // —— 剑意感应：真实 2 秒有效移动（技术验证融入开局）——
  if (phase === 'SENSING_GATE') {
    const pct = Math.round(Math.min(1, Math.max(0, props.sensingProgress)) * 100);
    return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>剑意感应</h2>
        <p className="mt-2 text-sm leading-6 text-[#cdefe8]/85">
          身份既定，先感应手中之剑。在下方舞台做一段出剑移动——真实挥剑两秒，剑意自应。
        </p>
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-[#cdefe8]/60">
            <span>剑意感应</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-[#cdefe8]/10"
            role="progressbar"
            aria-label="剑意感应进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full rounded-full bg-[hsl(var(--gold))]/70 transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#cdefe8]/50">
            摄像头或指针皆可；静止、收势或丢手只暂停，不清零。感应完成后进入基础御剑试炼。
          </p>
        </div>
      </UpperPanel>
    );
  }

  // —— 章回开场：阅读后进入试炼 ——
  if (phase === 'CHAPTER_EVENT' && props.opening) {
    return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>{props.opening.title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#cdefe8]/85">
          {props.opening.text}
        </p>
        <p className="mt-3 text-xs text-[#cdefe8]/55">
          章回之中，先完成基础御剑试炼，再以两剑定意与命。
        </p>
        <div className="mt-2 border-t border-[#cdefe8]/10 pt-1.5">
          <DirectorBadge loading={props.aiLoading} source={props.aiSource} fallbackReason={props.aiFallbackReason} />
        </div>
      </UpperPanel>
    );
  }

  // —— 两次命运选择：上半屏三选项，下半屏御剑确认 ——
  if ((phase === 'FATE_CHOICE_INTENT' || phase === 'FATE_CHOICE_FATE') && props.event) {
    // 事件状态机：NARRATIVE_PENDING（剑意落字中）→ 选项与确认剑全锁；
    // CHOICE_COMMITTED（剑已确认）→ 不可改选。
    const ev = state.activeEvent;
    const locked = ev?.phase !== 'CHOICE_READY';
    const committed = ev?.phase === 'CHOICE_COMMITTED';
    if (ev?.chosenOptionId) return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>{props.event.title} · 剑已落定</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#cdefe8]/85">
          {ev.phase === 'NARRATIVE_READY' ? props.event.text : '剑意落字中……你的这一剑，正在写下此后的路。'}
        </p>
        <div className="life-actions mt-3">
          <Button variant="arena" disabled={ev.phase !== 'NARRATIVE_READY'} onClick={props.onContinueChoice}>
            读罢 · 继续前行
          </Button>
        </div>
      </UpperPanel>
    );
    return (
      <UpperPanel className="top-2">
        <h2 className={cn('font-display text-lg', gold)}>{props.event.title}</h2>
        {props.event.text && (
          <p className="mt-1.5 whitespace-pre-line text-xs leading-5 text-[#cdefe8]/75">
            {props.event.text}
          </p>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {props.event.options.map((o, i) => {
            const selected = props.pendingChoiceId === o.id;
            return (
              <FateSlip
                key={o.id}
                index={i}
                option={o}
                selected={selected}
                committed={committed}
                locked={locked}
                onSelect={() => props.onSelectOption(o.id)}
              />
            );
          })}
        </div>
        <div className="mt-2 flex min-h-4 items-center">
          <DirectorBadge loading={props.aiLoading} source={props.aiSource} fallbackReason={props.aiFallbackReason} />
        </div>
        <div className="mt-2 border-t border-[#cdefe8]/10 pt-2 text-center text-xs leading-5">
          {ev?.phase === 'NARRATIVE_PENDING' ? (
            <p className="text-[#cdefe8]/45">剑意落字中…… 落定后方可择意</p>
          ) : committed ? (
            <p className="text-[#cdefe8]/55">剑已落定 · 此择不可反悔</p>
          ) : props.pendingChoiceId ? (
            <p className={gold}>
              {props.confirmHint === 'sheathed'
                ? '剑已收势 · 请出剑确认'
                : '已择其一 · 在下方舞台做一段出剑移动，以剑确认'}
            </p>
          ) : (
            <p className="text-[#cdefe8]/60">先择其一，再以剑确认</p>
          )}
        </div>
      </UpperPanel>
    );
  }

  // —— 同行者互动：可跳过（正文落定前锁定回应）——
  if (phase === 'COMPANION_EVENT' && props.companionText) {
    // 事件状态机：NARRATIVE_PENDING（剑意落字中）→ 回应按钮锁定
    const ev = state.activeEvent;
    const locked = props.aiLoading || !ev || ev.phase !== 'NARRATIVE_READY';
    return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>{props.companionText.title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#cdefe8]/85">
          {props.companionText.text}
        </p>
        <p className="mt-1 text-xs text-[#cdefe8]/55">{COMPANION.stance}</p>
        <div className="mt-1 flex min-h-4 items-center">
          <DirectorBadge loading={props.aiLoading} source={props.aiSource} fallbackReason={props.aiFallbackReason} />
        </div>
        {ev?.phase === 'NARRATIVE_PENDING' && (
          <p className="mt-2 text-center text-xs leading-5 text-[#cdefe8]/45">
            剑意落字中…… 落定后方可回应
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="arena"
            className="flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={locked}
            onClick={() => props.onRespondCompanion('warm')}
          >
            {COMPANION.responses.warm.label}
          </Button>
          <Button
            variant="arena"
            className="flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={locked}
            onClick={() => props.onRespondCompanion('reserved')}
          >
            {COMPANION.responses.reserved.label}
          </Button>
          <Button
            variant="arena"
            className="flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={locked}
            onClick={() => props.onRespondCompanion('skip')}
          >
            {COMPANION.skip.label}
          </Button>
        </div>
      </UpperPanel>
    );
  }

  // —— 剑道机缘：左侧古剑谱，右侧保留真实舞台练习 ——
  if (phase === 'TECHNIQUE_GATE' && props.techniqueEvent) {
    const te = props.techniqueEvent;
    const learning = te.ready && (te.stage === 'MANUAL_RECEIVED' || te.stage === 'LEARNING');
    return (
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="absolute inset-x-2 top-2 flex flex-col items-center md:bottom-5 md:left-6 md:right-auto md:top-6 md:w-[min(360px,38vw)]">
          <div data-ui-interactive className="manual-page anim-unfurl pointer-events-auto relative w-full overflow-y-auto rounded-sm p-4 md:p-5" style={{ maxHeight: '68vh' }}>
            <p className="vertical-title absolute right-2.5 top-4 text-[10px] text-[#8a7448]">{te.source}</p>
            <h2 className="pr-10 font-display text-xl tracking-[.2em] text-[#2e2820]">{te.name}</h2>
            <div className="ink-divider my-3" />
            <div className="rounded-sm border border-[#a08a5c]/40 bg-[#f8f2e073] px-2 py-1">
              <ManualDemoTrace kind={te.kind} />
              <p className="pb-1.5 text-center text-[10px] tracking-[.2em] text-[#8a7448]">剑痕示意</p>
            </div>
            <div className="mt-3 whitespace-pre-line text-[13px] leading-6 text-[#4a4234]">
              {props.aiLoading ? <InkPending compact /> : learning ? '剑诀已领。在右侧画中完成剑路；只认轨迹，无需命中敌人。' : (te.body ?? te.teachingText)}
            </div>
            <div className="mt-3 border-l-2 border-[#a2332c]/60 pl-3 text-[11px] leading-5 text-[#a2332c]">练习 · {te.practiceHint}</div>
            <div className="mt-3">
              {!te.ready && <p className="text-[10px] leading-4 text-[#8a7448]">传承叙事落字中…… 落定后方可练习成招</p>}
              {learning && <p className="text-[11px] leading-5 text-[#7a5c34]">已领受 · 有效轨迹 {te.practiceProgress.done}/{te.practiceProgress.required} · 松开后可重新练习</p>}
              {te.stage === 'MASTERED' && <p className="flex items-center gap-2 text-xs text-[#a2332c]"><span className="seal-mark anim-seal size-7 text-[11px]">悟</span>已领悟 · {te.name}</p>}
            </div>
            {te.learnedNames.length > 0 && <p className="mt-3 text-xs text-[#6b5f4a]">本章已悟：{te.learnedNames.join(' · ')}</p>}
            <div className="mt-2"><DirectorBadge loading={props.aiLoading} source={props.aiSource} fallbackReason={props.aiFallbackReason} /></div>
          </div>
          {te.ready && te.stage === 'OPPORTUNITY_AVAILABLE' && (
            <Button variant="arena" data-ui-interactive className="pointer-events-auto mt-3 w-full border-[#bca474]/45 bg-[#161b1b]/95 text-[#efe5c8]" onClick={props.onAcknowledgeManual}>
              <BookOpenCheck className="size-4" /> 领受剑谱 · 开始练习
            </Button>
          )}
        </div>
        {learning && <div className="hud-panel anim-unfurl absolute right-4 top-4 rounded-sm px-3.5 py-2 text-[13px] text-[#dcf3ea]"><span className="mr-2 inline-block size-1.5 rounded-full bg-[#9fd8c8] shadow-[0_0_6px_#9fd8c8]" />剑已入手 · 于画中出剑练习 <span className="ml-2 text-[#9fd8c8]">{te.practiceProgress.done}/{te.practiceProgress.required}</span></div>}
      </div>
    );
  }

  // —— 第九阶段：BOSS_GATE —— 舞台浮层由 BossOverlays 渲染（idle 引导/失败重试），
  //     上半屏不再叠面板，避免遮挡 Boss 预警与投射物。
  if (phase === 'BOSS_GATE') return null;

  // —— 第一章结算 ——
  if (phase === 'CHAPTER_RESULT' && props.chapterResult) {
    return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>{props.chapterResult.title}</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-6 text-[#cdefe8]/85">
          {props.chapterResult.lines.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-[hsl(var(--gold))]/60" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-[#cdefe8]/60">境界：剑道初相 → 练气一层</span>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="arena" size="sm" onClick={props.onOpenLedger}>
              <ScrollText /> 命簿
            </Button>
            <Button variant="arena" size="sm" onClick={props.onReplayChapter}>
              <RotateCcw /> 重新历练
            </Button>
            <Button
              variant="arena"
              size="sm"
              onClick={props.onEnterJourney}
              disabled={props.aiLoading || state.activeEvent?.phase !== 'NARRATIVE_READY'}
              title={props.aiLoading ? '剑意落字中 · 落定后方可收束' : undefined}
            >
              <ArrowRight /> 收束此章
            </Button>
          </div>
        </div>
        <div className="mt-2 border-t border-[#cdefe8]/10 pt-1.5">
          <DirectorBadge loading={props.aiLoading} source={props.aiSource} fallbackReason={props.aiFallbackReason} />
          {props.aiLoading && (
            <p className="mt-1 text-[10px] leading-4 text-[#cdefe8]/40">
              剑道初相评价落字中 · 此章收束暂锁
            </p>
          )}
        </div>
      </UpperPanel>
    );
  }

  // —— 踏入九州：本阶段边界（无地图）——
  if (phase === 'JOURNEY_GATE' && props.journey) {
    return (
      <UpperPanel>
        <h2 className={cn('font-display text-lg', gold)}>{props.journey.title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#cdefe8]/85">{props.journey.text}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#cdefe8]/60">
          <span>境界：练气一层</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {companionLabel(state.companionState)}
          </span>
          <span>本章历练 · {state.replayCount > 0 ? `已重历 ${state.replayCount} 次` : '初历'}</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button variant="arena" className="flex-1" onClick={props.onOpenLedger}>
            <ScrollText /> 查看命簿
          </Button>
          <Button variant="arena" className="flex-1" onClick={props.onReplayChapter}>
            <RotateCcw /> 重新历练本章
          </Button>
          <Button variant="arena" className="flex-1" disabled>
            继续踏入九州 · 属于下一段路
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-[#cdefe8]/45">
          重新历练：保留身份与命簿历史，回到第一章开端再历两剑。
          （踏入九州的九州山川与剑缘，属于下一段路。）
        </p>
      </UpperPanel>
    );
  }

  // TRIAL_GATE：战斗照常进行（无浮层，右栏 Life 卡片显示人生状态）
  return null;
}

function companionLabel(cs: CompanionState): string {
  if (cs.response === 'warm') return '同行者 · 燕迟（已应下）';
  if (cs.response === 'reserved') return '同行者 · 燕迟（默然同路）';
  if (cs.skipped) return '同行者 · 燕迟（未同行）';
  return '独行';
}

/** 右栏人生状态卡（试炼期间显示当前人生进度 + 命簿入口） */
export function LifeStatusCard({
  state,
  onOpenLedger,
}: {
  state: LifeState;
  onOpenLedger?: () => void;
}) {
  const inLife = state.phase !== 'TRIAL_GATE';
  if (inLife) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Swords className="size-3.5" />
        剑修人生
      </h2>
      <p className="mt-2 text-sm">
        <span className={cn('font-medium', gold)}>{state.profile?.name ?? '无名剑客'}</span>
        <span className="ml-2 text-xs text-muted-foreground">境界 · {state.realm}</span>
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        第一章 · 雾岭第一剑 —— 试炼通过后，以两剑择意定命。
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        <span>命簿 · 已历 {state.ledger.chapterCompletionCount} 章</span>
        {onOpenLedger && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={onOpenLedger}
          >
            <ScrollText className="size-3" /> 查看命簿
          </Button>
        )}
      </div>
    </section>
  );
}

function FateSlip({ index, option, selected, committed, locked, onSelect }: {
  index: number;
  option: ChoiceEvent['options'][number];
  selected: boolean;
  committed: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" disabled={locked} onClick={onSelect} className={cn(
      'fate-slip group relative rounded-sm px-4 py-3 text-left transition-all duration-300',
      locked && 'cursor-not-allowed opacity-40', selected && !committed && 'scale-[1.015] border-[#c8ae73]/70', committed && !selected && 'opacity-30',
    )}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[15px] tracking-[.12em]">{option.title}</span>
        <span className="text-[10px] text-[#b29c66]/60">{['其一','其二','其三'][index]}</span>
      </span>
      <span className="mt-1.5 block text-xs leading-5 text-[#b8b09c]">{option.shortText}</span>
      {option.flavor && <span className="mt-1 block text-[10px] leading-4 text-[#c07a5e]/80">{option.flavor}</span>}
      {selected && !committed && <span className="sword-flash" aria-hidden="true" />}
      {selected && committed && <span className="seal-mark anim-seal absolute -right-1.5 -top-2 size-7 text-[11px]">定</span>}
    </button>
  );
}

function ManualDemoTrace({ kind }: { kind: 'diagonalSlash' | 'cross' | 'returnWind' }) {
  return (
    <svg viewBox="0 0 120 90" className="h-20 w-full" aria-hidden="true">
      {(kind === 'diagonalSlash' || kind === 'cross') && <path d="M20 70L100 14" stroke="#3a4a42" strokeWidth="2" strokeLinecap="round" fill="none" className="demo-stroke" />}
      {kind === 'cross' && <path d="M22 16L98 72" stroke="#3a4a42" strokeWidth="2" strokeLinecap="round" fill="none" className="demo-stroke" style={{ animationDelay: '.55s' }} />}
      {kind === 'returnWind' && <path d="M60 20C92 22 98 48 74 66 56 78 30 72 26 52 23 36 38 24 58 24" stroke="#3a4a42" strokeWidth="2" strokeLinecap="round" fill="none" className="demo-stroke" />}
    </svg>
  );
}

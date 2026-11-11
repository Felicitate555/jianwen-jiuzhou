/**
 * 第八阶段：命簿（长期人生档案）可关闭轻量面板。
 * - 纯展示：数据全部来自 buildLedgerView（LifeState 投影），无本地业务状态；
 * - open=false 完全不渲染（不占 DOM、不启任何循环）；
 * - 打开/关闭不触发 AI 请求 / Combat update / 输入循环（无 useEffect、无订阅）；
 * - 样式克制：墨青底、青白正文、少量暖金（hsl(var(--gold))）与朱红点缀。
 */
import { Feather, ScrollText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildLedgerView } from '@/life/lifeLedger';
import type { LifeState } from '@/life/lifeTypes';

const gold = 'text-[hsl(var(--gold))]';

export interface LifeLedgerProps {
  /** 打开状态（App 纯 UI state 控制） */
  open: boolean;
  onClose: () => void;
  state: LifeState;
  /** 持久存储是否可用（localStorage 不可用时显示可读提示） */
  persistent: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-[#876f43]/20 pt-3">
      <h3 className="text-xs font-medium tracking-[.18em] text-[#7b6540]">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/** AI 来源一行概览（轻量元数据，不复制 AI 正文） */
function NarrativeSourceBadge({
  source,
  reason,
}: {
  source: 'ai' | 'deterministic' | null;
  reason: string | null;
}) {
  if (source === null) {
    return <span className="text-[10px] text-[#cdefe8]/40">叙事 · 未记录</span>;
  }
  if (source === 'ai') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--gold))]/60">
        <Feather className="size-3" />
        AI导演
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[#cdefe8]/40">
      <Feather className="size-3" />
      固定导演{reason ? '（降级）' : ''}
    </span>
  );
}

export function LifeLedger(props: LifeLedgerProps) {
  if (!props.open) return null;
  const view = buildLedgerView(props.state);
  const hasProfile = view.profile !== null;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(3,7,9,.84)] p-3 backdrop-blur-[4px]"
      role="dialog"
      aria-label="命簿"
    >
      <div data-ui-interactive className="ledger-book anim-unfurl pointer-events-auto flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm">
        {/* 头部 */}
        <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-[#876f43]/25 px-6 py-4">
          <h2 className="flex items-center gap-2 font-display text-xl tracking-[.22em] text-[#3a3226]">
            <ScrollText className="size-4" />
            命簿 · {view.profile?.name ?? '无名'}
          </h2>
          <Button variant="ghost" size="sm" className="size-8 p-0 text-[#6d5b3b]" onClick={props.onClose}>
            <X className="size-4" />
            <span className="sr-only">关闭命簿</span>
          </Button>
        </div>

        {/* 内容（滚动区） */}
        <div className="ledger-copy ledger-frame relative z-10 m-3 min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:columns-2 md:gap-10 md:px-7">
          {!props.persistent && (
            <p className="mt-2 text-xs leading-5 text-[#c07a5e]">
              此环境无法持久保存命簿（浏览器存储不可用），本次查看后记录不会留存。
            </p>
          )}
          {!hasProfile ? (
            <p className="mt-4 text-sm leading-6 text-[#cdefe8]/70">
              尚未立身。先择性别、推演身份，命簿自会记下你的一笔一剑。
            </p>
          ) : (
            <>
              {/* 本局身份 */}
              <Section title="本局身份">
                <p className="text-sm leading-6 text-[#cdefe8]/85">
                  <span className={gold}>{view.profile!.name}</span>
                  <span className="ml-2 text-xs text-[#cdefe8]/55">
                    {view.profile!.gender === 'female' ? '女' : '男'} · {view.profile!.originTitle}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-5 text-[#cdefe8]/60">{view.profile!.originText}</p>
              </Section>

              {/* 残缺体质 */}
              <Section title="残缺体质">
                <p className="text-sm leading-6">
                  <span className={gold}>{view.profile!.constitutionTitle}</span>
                  <span className="ml-2 inline-flex gap-1 align-middle">
                    {view.profile!.constitutionTags.map((t) => (
                      <span
                        key={t}
                        className="rounded-sm border border-[#cdefe8]/20 px-1.5 py-0.5 text-[10px] text-[#cdefe8]/60"
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-5 text-[#cdefe8]/60">
                  {view.profile!.constitutionText}
                </p>
                <p className="mt-1.5 text-[11px] leading-5 text-[#cdefe8]/50">
                  {view.profile!.constitutionNote}
                </p>
              </Section>

              {/* 第一章命痕 */}
              <Section title="第一章命痕">
                {view.chapterMarks.intent || view.chapterMarks.fate ? (
                  <div className="space-y-2">
                    {view.chapterMarks.intent && (
                      <div>
                        <p className="text-sm text-[#cdefe8]/85">
                          {view.chapterMarks.intent.title} ——{' '}
                          <span className={gold}>{view.chapterMarks.intent.optionTitle}</span>
                        </p>
                        <p className="text-xs leading-5 text-[#cdefe8]/60">
                          {view.chapterMarks.intent.resultText}
                        </p>
                      </div>
                    )}
                    {view.chapterMarks.fate && (
                      <div>
                        <p className="text-sm text-[#cdefe8]/85">
                          {view.chapterMarks.fate.title} ——{' '}
                          <span className={gold}>{view.chapterMarks.fate.optionTitle}</span>
                        </p>
                        <p className="text-xs leading-5 text-[#cdefe8]/60">
                          {view.chapterMarks.fate.resultText}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-[#cdefe8]/50">
                      境界：剑道初相 → {view.realm}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[#cdefe8]/55">两剑未落，命痕未成。</p>
                )}
              </Section>

              {/* 同行者 */}
              <Section title="同行者">
                <p className="text-sm leading-6 text-[#cdefe8]/85">
                  {view.companion.met ? view.companion.name : '独行'}
                  {view.companion.met && view.companion.response === 'warm' && ' · 已应下同行'}
                  {view.companion.met && view.companion.response === 'reserved' && ' · 默然同路'}
                  {view.companion.met && view.companion.response === null && ' · 尚未回应'}
                  {view.companion.flagLabel && (
                    <span className="ml-2 text-xs text-[#cdefe8]/55">
                      旗标 · {view.companion.flagLabel}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-[#cdefe8]/45">
                  同行是一段路的事，不涉数值，不问永远。
                </p>
              </Section>

              {/* 历练记录 */}
              <Section title={`历练记录 · 共 ${view.completionCount} 次`}>
                {view.history.length === 0 ? (
                  <p className="text-sm leading-6 text-[#cdefe8]/55">
                    尚未走完第一章。命簿只记已落定之事，不写虚言。
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {view.history.map((h) => (
                      <li
                        key={h.runId}
                        className="rounded-sm border border-[#cdefe8]/12 px-3 py-2 text-sm leading-6 text-[#cdefe8]/85"
                      >
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className={gold}>{`第 ${h.seq} 次`}</span>
                          <span className="text-xs text-[#cdefe8]/60">
                            {h.intentTitle} → {h.fateTitle}
                          </span>
                          {h.companionResponse === 'warm' && (
                            <span className="text-[10px] text-[#cdefe8]/45">携友</span>
                          )}
                          {h.companionResponse === 'reserved' && (
                            <span className="text-[10px] text-[#cdefe8]/45">默行</span>
                          )}
                          {h.companionResponse === 'skip' && (
                            <span className="text-[10px] text-[#cdefe8]/45">独行</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-[#cdefe8]/55">
                          {h.realmFrom} → {h.realmTo}
                          {h.replayIndex > 0 ? ` · 重历第 ${h.replayIndex + 1} 遍` : ''}
                        </p>
                        <p className="mt-0.5">
                          <NarrativeSourceBadge
                            source={h.narrativeSource}
                            reason={h.narrativeFallbackReason}
                          />
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-2 text-[11px] leading-5 text-[#cdefe8]/45">
                  本章已重历 {view.replayCount} 次 · 命簿只存选项与旗标，不存摄像头与战斗之影。
                </p>
              </Section>
            </>
          )}
        </div>

        {/* 底部：关闭 */}
        <div className="relative z-10 shrink-0 border-t border-[#876f43]/25 px-5 py-3">
          <Button variant="outline" size="sm" className="w-full border-[#806b45]/45 bg-[#3a3226] text-[#f2e8d2] hover:bg-[#4b4031] hover:text-white" onClick={props.onClose}>
            合上命簿
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 第八阶段：命簿（LifeLedger）——长期人生档案的纯数据层。
 * 职责边界：
 * - 只做 LifeState 的投影/追加/校验，不接触 landmark/MediaStream/Canvas/敌人 HP/qi/战斗内部；
 * - 历史条目幂等（runId = seed:replayIndex），旧回调/刷新/重复点击不产生重复记录；
 * - AI 只允许经注解接口写入轻量元数据（narrativeSource/fallbackReason），不改任何规则字段；
 * - 为第二章/机缘修补/流派扩展提供稳定可迁移的数据底座。
 */
import {
  FATE_OPTIONS,
  INTENT_OPTIONS,
  LIFE_CONSTITUTIONS,
  LIFE_ORIGINS,
} from './lifeConfig';
import type { LifeState } from './lifeTypes';

/** 命簿结构版本（与 LifeState.schemaVersion 独立演进） */
export const LEDGER_SCHEMA_VERSION = 1;

/** 一条已完成的章节历史（纯事实，无 AI 正文，无摄像头/战斗数据） */
export interface ChapterHistoryEntry {
  /** 稳定 run 标识：seed:replayIndex（同一 run 幂等键） */
  runId: string;
  /** 完成序号（1 起，全历史递增） */
  seq: number;
  /** 完成时间戳（ms） */
  finishedAt: number;
  /** 第一剑·择意 真实选项 */
  intentId: string;
  intentTitle: string;
  /** 第二剑·定命 真实选项 */
  fateId: string;
  fateTitle: string;
  /** 本 run 固定后果旗标（含 intent-/fate-/companion- 前缀） */
  resultFlags: string[];
  /** 同行者回应（warm/reserved/skip；跳过记 skip） */
  companionResponse: 'warm' | 'reserved' | 'skip';
  /** 境界变化（当前恒为 剑道初相→练气一层，字段保留供第二章扩展） */
  realmFrom: string;
  realmTo: string;
  /** 重历序号（0 起；与 runId 尾段一致） */
  replayIndex: number;
  /** AI 叙事来源概览（仅轻量元数据；规则外文案不落史册） */
  narrativeSource: 'ai' | 'deterministic' | null;
  narrativeFallbackReason: string | null;
}

/** 持久化命簿（随 LifeState 同键存储） */
export interface LifeLedgerData {
  schemaVersion: number;
  /** 身份 seed 快照（新开一局/重新生成身份时更新） */
  profileSeed: number;
  /** 已完成第一章次数（= 历史条目数，冗余计数便于直接展示） */
  chapterCompletionCount: number;
  /** 简洁历史条目（seq 递增，永不覆盖） */
  history: ChapterHistoryEntry[];
  updatedAt: number;
}

/** 空 ledger 常量（旧档迁移默认值） */
export function emptyLedger(seed: number, nowMs = 0): LifeLedgerData {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    profileSeed: seed,
    chapterCompletionCount: 0,
    history: [],
    updatedAt: nowMs,
  };
}

/** 当前 run 标识（追加与注解共用；phase 无关，纯函数） */
export function currentRunId(state: Pick<LifeState, 'seed' | 'replayCount'>): string {
  return `run:${state.seed}:${state.replayCount}`;
}

/** 追加入参（引擎在 CHAPTER_RESULT 时组装） */
export interface AppendEntryInput {
  seed: number;
  replayIndex: number;
  finishedAt: number;
  intentId: string;
  fateId: string;
  resultFlags: string[];
  companionResponse: 'warm' | 'reserved' | 'skip';
}

/**
 * 追加一条章节历史（幂等）：runId 已存在 → 不追加不覆盖（返回 appended=false）。
 * 纯函数：返回新对象，不修改入参。
 */
export function appendChapterEntry(
  ledger: LifeLedgerData,
  input: AppendEntryInput,
): { ledger: LifeLedgerData; appended: boolean } {
  const runId = `run:${input.seed}:${input.replayIndex}`;
  if (ledger.history.some((h) => h.runId === runId)) {
    return { ledger, appended: false };
  }
  const intent = INTENT_OPTIONS.find((o) => o.id === input.intentId);
  const fate = FATE_OPTIONS.find((o) => o.id === input.fateId);
  const entry: ChapterHistoryEntry = {
    runId,
    seq: ledger.history.length + 1,
    finishedAt: input.finishedAt,
    intentId: input.intentId,
    intentTitle: intent?.title ?? input.intentId,
    fateId: input.fateId,
    fateTitle: fate?.title ?? input.fateId,
    resultFlags: [...input.resultFlags],
    companionResponse: input.companionResponse,
    realmFrom: '剑道初相',
    realmTo: '练气一层',
    replayIndex: input.replayIndex,
    narrativeSource: null,
    narrativeFallbackReason: null,
  };
  return {
    ledger: {
      ...ledger,
      chapterCompletionCount: ledger.chapterCompletionCount + 1,
      history: [...ledger.history, entry],
      updatedAt: input.finishedAt,
    },
    appended: true,
  };
}

/**
 * 严格校验（lifeStorage 载入用）：结构非法 → null（整档安全回退）。
 * 单条历史非法（选项 id 越界等）→ 只丢弃该条，其余保留。
 */
export function validateLedger(
  raw: unknown,
  seed: number,
): LifeLedgerData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) return null;
  if (typeof o.profileSeed !== 'number') return null;
  if (
    typeof o.chapterCompletionCount !== 'number' ||
    !Number.isInteger(o.chapterCompletionCount) ||
    o.chapterCompletionCount < 0
  ) {
    return null;
  }
  if (!Array.isArray(o.history)) return null;
  if (typeof o.updatedAt !== 'number') return null;
  const history: ChapterHistoryEntry[] = [];
  for (const h of o.history) {
    if (typeof h !== 'object' || h === null) return null;
    const e = h as Record<string, unknown>;
    if (typeof e.runId !== 'string' || !/^run:\d+:\d+$/.test(e.runId)) return null;
    if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 1) return null;
    if (typeof e.finishedAt !== 'number') return null;
    const intentId: unknown = e.intentId;
    const fateId: unknown = e.fateId;
    const intentOk = typeof intentId === 'string' && INTENT_OPTIONS.some((o2) => o2.id === intentId);
    const fateOk = typeof fateId === 'string' && FATE_OPTIONS.some((o2) => o2.id === fateId);
    if (!intentOk || !fateOk) continue; // 单条非法：丢弃该条继续
    const intentTitle = e.intentTitle;
    const fateTitle = e.fateTitle;
    if (typeof intentTitle !== 'string') return null;
    if (typeof fateTitle !== 'string') return null;
    if (!Array.isArray(e.resultFlags) || e.resultFlags.some((f) => typeof f !== 'string')) return null;
    if (
      e.companionResponse !== 'warm' &&
      e.companionResponse !== 'reserved' &&
      e.companionResponse !== 'skip'
    ) {
      return null;
    }
    const realmFrom = e.realmFrom;
    const realmTo = e.realmTo;
    if (typeof realmFrom !== 'string' || typeof realmTo !== 'string') return null;
    if (typeof e.replayIndex !== 'number' || !Number.isInteger(e.replayIndex) || e.replayIndex < 0) {
      return null;
    }
    if (
      e.narrativeSource !== null &&
      e.narrativeSource !== 'ai' &&
      e.narrativeSource !== 'deterministic'
    ) {
      return null;
    }
    if (e.narrativeFallbackReason !== null && typeof e.narrativeFallbackReason !== 'string') {
      return null;
    }
    history.push({
      runId: e.runId,
      seq: e.seq as number,
      finishedAt: e.finishedAt,
      intentId,
      intentTitle,
      fateId,
      fateTitle,
      resultFlags: [...(e.resultFlags as string[])],
      companionResponse: e.companionResponse as 'warm' | 'reserved' | 'skip',
      realmFrom,
      realmTo,
      replayIndex: e.replayIndex as number,
      narrativeSource: e.narrativeSource as 'ai' | 'deterministic' | null,
      narrativeFallbackReason: e.narrativeFallbackReason as string | null,
    });
  }
  // 顺序修复：按 seq 递增排序（防旧档乱序）
  history.sort((a, b) => a.seq - b.seq);
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    profileSeed: typeof o.profileSeed === 'number' ? o.profileSeed : seed,
    chapterCompletionCount: Math.max(o.chapterCompletionCount, history.length),
    history,
    updatedAt: o.updatedAt,
  };
}

/** ============ 投影（纯数据视图，UI 直接渲染） ============ */

/** 身份区视图（真实事实 + 体质可能性，明确标注为后续阶段） */
export interface LedgerProfileView {
  name: string;
  gender: 'male' | 'female';
  originTitle: string;
  originText: string;
  constitutionId: string;
  constitutionTitle: string;
  constitutionText: string;
  constitutionTags: string[];
  repairable: boolean;
  transformable: boolean;
  pathTags: string[];
  /** 体质可能性说明（明确是后续机缘，不是已拥有） */
  constitutionNote: string;
}

/** 命痕区：一剑视图 */
export interface ChoiceMarkView {
  stage: 'intent' | 'fate';
  title: string;
  optionTitle: string;
  optionId: string;
  resultText: string;
}

/** 同行者区视图 */
export interface LedgerCompanionView {
  name: string;
  met: boolean;
  response: 'warm' | 'reserved' | 'skip' | null;
  flag: string | null;
  /** 本章互动是否已回应（含跳过） */
  completed: boolean;
  /** 非数值旗标名（展示用） */
  flagLabel: string | null;
}

/** 历练记录区视图（= 历史条目直接渲染） */
export type LedgerHistoryView = ChapterHistoryEntry;

/** 命簿完整视图 */
export interface LedgerView {
  profile: LedgerProfileView | null;
  chapterMarks: { intent: ChoiceMarkView | null; fate: ChoiceMarkView | null };
  companion: LedgerCompanionView;
  realm: string;
  replayCount: number;
  completionCount: number;
  history: LedgerHistoryView[];
  chapterIndex: number;
  updatedAt: number;
}

const COMPANION_FLAG_LABELS: Record<string, string> = {
  'companion-warm': '并肩之诺',
  'companion-reserved': '默然同路',
  'companion-reserved?': '默然同路',
};

/**
 * 投影：state + 固定配置 → 渲染视图。
 * 纯函数：无 storage 写入、无 AI 调用、无随机性；AI 结果不影响任何字段。
 */
export function buildLedgerView(state: LifeState): LedgerView {
  const p = state.profile;
  const origin = p ? LIFE_ORIGINS.find((o) => o.id === p.originId) : undefined;
  const cons = p ? LIFE_CONSTITUTIONS.find((c) => c.id === p.constitutionId) : undefined;
  const intent = state.chosen.intent
    ? INTENT_OPTIONS.find((o) => o.id === state.chosen.intent)
    : undefined;
  const fate = state.chosen.fate
    ? FATE_OPTIONS.find((o) => o.id === state.chosen.fate)
    : undefined;
  const cs = state.companionState;
  const possibilities: string[] = [];
  if (cons?.repairable) possibilities.push('可修补');
  if (cons?.transformable) possibilities.push('可转化为流派根基');
  const pathNote = cons?.pathTags.length ? `，倾向 ${cons.pathTags.join('、')}` : '';
  const constitutionNote = cons
    ? `此为残缺之身的事实。${possibilities.join('，')}等机缘属于后续路途${pathNote}，此刻尚未开始。`
    : '';
  return {
    profile: p
      ? {
          name: p.name,
          gender: p.gender,
          originTitle: origin?.title ?? '未知之地',
          originText: origin?.text ?? '',
          constitutionId: p.constitutionId,
          constitutionTitle: cons?.title ?? '未知',
          constitutionText: cons?.text ?? '',
          constitutionTags: cons?.tags ?? [],
          repairable: cons?.repairable ?? false,
          transformable: cons?.transformable ?? false,
          pathTags: cons?.pathTags ?? [],
          constitutionNote,
        }
      : null,
    chapterMarks: {
      intent: intent
        ? {
            stage: 'intent',
            title: '第一剑 · 择意',
            optionTitle: intent.title,
            optionId: intent.id,
            resultText: intent.resultText,
          }
        : null,
      fate: fate
        ? {
            stage: 'fate',
            title: '第二剑 · 定命',
            optionTitle: fate.title,
            optionId: fate.id,
            resultText: fate.resultText,
          }
        : null,
    },
    companion: {
      name: '燕迟',
      met: cs.met,
      response: cs.response,
      flag: cs.flag,
      completed: cs.met && (cs.response !== null || cs.skipped),
      flagLabel: cs.flag ? (COMPANION_FLAG_LABELS[cs.flag] ?? cs.flag) : null,
    },
    realm: state.realm,
    replayCount: state.replayCount,
    completionCount: state.ledger.chapterCompletionCount,
    history: [...state.ledger.history],
    chapterIndex: state.chapterIndex,
    updatedAt: state.ledger.updatedAt,
  };
}
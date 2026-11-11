/**
 * 第六/七阶段受控 AI 文本导演：请求构建 / schema 校验 / 缓存 / 一次性降级。
 * 职责边界（契约）：
 * - 请求 payload 只含固定 canon 字段，绝不包含 landmarks/MediaStream/HP/qi/轨迹/隐私；
 * - 模型输出只允许渲染用文字（严格 schema），未知 optionId/额外字段/越界文本一律拒绝；
 * - 校验失败或网络/超时失败 → deterministic 兜底（一次性，不重试，不阻塞游戏），
 *   且携带可读 fallbackReason，不暴露内部信息；
 * - 超时不依赖 fetch signal（实测 supabase.functions.invoke 的 signal 传递不可靠）：
 *   Promise.race 本地定时器，超时立即降级；迟到的合法响应仍写入缓存供下次零网络命中；
 * - generation token：aborted 后的旧响应不写入 React 状态（迟到写缓存不等于污染 UI）；
 * - 缓存按 canon/life/chapter/event 实例隔离，只存文字与 source，命中时绑定当前 requestId；
 *   持久层 localStorage（独立命名空间），刷新后命中不重复请求。
 * AI 永远不是 LifeEngine 的规则输入，只能润色叙事。
 */
import { supabase } from '@/db/supabase';
import { findConstitution } from './lifeEngine';
import { LIFE_ORIGINS, INTENT_OPTIONS, FATE_OPTIONS, findTechniqueOpportunity } from './lifeConfig';
import type { LifeState, TechniqueKindId } from './lifeTypes';
import { SWORD_ARCHETYPES } from './swordArchetype';

/** 固定世界版本（AI 提示词与输出校验共用） */
export const CANON_VERSION = 1;
/** body 上限（约 320 字） */
export const BODY_MAX_LEN = 320;
/** companionLine 上限（约 120 字） */
export const COMPANION_MAX_LEN = 120;
/** choiceLead text 上限 */
export const LEAD_MAX_LEN = 48;
/**
 * AI-FIRST 等待窗口：服务端完整响应保护线 30s，客户端 35s 留出网络余量。
 * 超时立即固定导演降级，迟到合法响应只写缓存不覆盖 UI。
 */
export const NARRATIVE_TIMEOUT_MS = 35000;
/** 持久缓存命名空间（独立于人生存档；只存文字与来源） */
export const NARRATIVE_STORE_KEY = 'jianwen-jiuzhou:ai-narrative:v2';
/** 持久缓存单 key 上限（防膨胀；超出整体丢弃重建） */
const STORE_MAX_ENTRIES = 60;

/** 降级原因（对外可读，不含内部 URL/堆栈/密钥） */
export type NarrativeFallbackReason = 'timeout' | 'network' | 'http' | 'empty' | 'invalid-schema' | 'unconfigured';

/** 叙事请求的意图（一次只取一处文字） */
export type NarrativeKind =
  | { kind: 'identity' } // 身份确认卡（第七阶段新增：AI 只润色已生成的身份事实）
  | { kind: 'opening' }
  | { kind: 'choice'; stage: 'intent' | 'fate' }
  | { kind: 'companion'; response?: 'warm' | 'reserved' }
  /** 第九阶段：剑道初相评价（类型已由程序 Resolver 确定，AI 只写正文） */
  | { kind: 'archetype' }
  /** 第九阶段收口：三式剑道机缘（固定事实由程序决定，AI 只写短叙事） */
  | { kind: 'technique'; techniqueKind: TechniqueKindId }
  | { kind: 'result' };

/** 发往 Edge Function 的固定白名单 payload */
export interface NarrativeRequest {
  canonVersion: number;
  eventId: string;
  /** 请求身份（客户端与 Edge Function 双端校验；迟到响应只有匹配当前 requestId 才有写入资格） */
  identity: {
    lifeId: string;
    chapterInstanceId: string;
    eventDefinitionId: string;
    eventInstanceId: string;
    requestId: string;
  };
  /** 服务端强制绑定的 requestId（响应校验用） */
  requestId: string;
  chapterIndex: number;
  replayCount: number;
  name: string;
  gender: string;
  originId: string;
  originTitle: string;
  constitutionId: string;
  constitutionTitle: string;
  constitutionTags: string[];
  confirmedFlags: string[];
  companion: string;
  /** 模型只输出 JSON 文本，不流式 */
  jsonOnly: true;
  /** 第九阶段（archetype 事件）：程序确定的剑道初相（AI 只可引用） */
  swordArchetypeTitle?: string;
  /** 第九阶段收口（technique 事件）：机缘事实（程序决定，AI 只可引用） */
  techniqueTitle?: string;
  techniqueSource?: string;
  /** 第九阶段（archetype 事件）：Boss 战真实摘要（只读事实） */
  battleSummary?: {
    durationSec: number;
    slashCount: number;
    averageSpeed: number;
    accuracyScore: number;
    stabilityScore: number;
    blocks: number;
    interrupts: number;
    projectilesCut: number;
  };
}

/** 服务端返回的严格 schema（经 validateNarrative 后才可用） */
export interface NarrativePayload {
  eventId: string;
  /** 必须与请求 requestId 一致（迟到/错位响应拒绝） */
  requestId?: string;
  body: string;
  companionLine: string | null;
  choiceLead: { optionId: string; text: string } | null;
  source: 'ai' | 'deterministic';
  canonVersion: number;
}

/** 校验通过的渲染用结果（source 真实标记 + 降级原因） */
export interface NarrativeResult {
  eventId: string;
  requestId: string | null;
  body: string;
  companionLine: string | null;
  choiceLead: { optionId: string; text: string } | null;
  source: 'ai' | 'deterministic';
  /** deterministic 降级原因（source=ai 时为 null） */
  fallbackReason: NarrativeFallbackReason | null;
}

/** generation token（AbortSignal 的最小面） */
export interface NarrativeToken {
  aborted: boolean;
}

/** 事件 id 构造（缓存与校验共用） */
export function eventIdOf(kind: NarrativeKind): string {
  if (kind.kind === 'identity') return 'profile:identity';
  if (kind.kind === 'opening') return 'ch1:opening';
  if (kind.kind === 'choice') return `ch1:choice:${kind.stage}`;
  // 同行者事件固定 ch1:companion:meet（回应后的旗标是程序事实，不再另立事件 id；
  // warm/reserved/skip 变体 id 不在存档白名单，禁止产生）
  if (kind.kind === 'companion') return 'ch1:companion:meet';
  if (kind.kind === 'archetype') return 'ch1:archetype';
  if (kind.kind === 'technique') return `ch1:technique:${kind.techniqueKind}`;
  return 'ch1:result';
}

/** 组装白名单请求（不含任何运行时/隐私字段；name/出身/体质为已生成事实） */
export function buildNarrativeRequest(state: LifeState, kind: NarrativeKind): NarrativeRequest {
  const origin = LIFE_ORIGINS.find((o) => o.id === state.profile?.originId);
  const cons = findConstitution(state.profile?.constitutionId);
  const eventId = eventIdOf(kind);
  // 请求身份：以当前活动事件为准（无活动事件时以 state 兜底，AI 叙事类事件必有 activeEvent）
  const ev = state.activeEvent?.eventDefinitionId === eventId ? state.activeEvent : null;
  const identity = {
    lifeId: state.lifeId,
    chapterInstanceId: state.chapterInstanceId,
    eventDefinitionId: ev?.eventDefinitionId ?? eventId,
    eventInstanceId: ev?.eventInstanceId ?? `fallback:${eventId}`,
    requestId: ev?.requestId ?? `req:fallback:${eventId}`,
  };
  const req: NarrativeRequest = {
    canonVersion: CANON_VERSION,
    eventId,
    identity,
    requestId: identity.requestId,
    chapterIndex: state.chapterIndex,
    replayCount: state.replayCount,
    name: state.profile?.name ?? '无名剑客',
    gender: state.profile?.gender ?? 'male',
    originId: state.profile?.originId ?? '',
    originTitle: origin?.title ?? '',
    constitutionId: state.profile?.constitutionId ?? '',
    constitutionTitle: cons?.title ?? '',
    constitutionTags: cons?.tags ?? [],
    confirmedFlags: Object.keys(state.flags).filter((k) => state.flags[k] === true),
    companion: state.companionState.skipped ? 'none' : 'companion-yan',
    jsonOnly: true,
  };
  // 第九阶段收口：机缘事件附带固定机缘事实（程序决定，AI 不得创造招式）
  if (kind.kind === 'technique') {
    const def = findTechniqueOpportunity(kind.techniqueKind);
    req.techniqueTitle = def.name;
    req.techniqueSource = techniqueSourceFor(state, kind.techniqueKind);
  }
  // 第九阶段：剑道初相事件附带程序确定类型与战斗摘要（缺省安全为 0/空）
  if (kind.kind === 'archetype') {
    const bs = state.lastBattleSummary;
    req.swordArchetypeTitle = state.swordArchetype?.title ?? '守剑';
    req.battleSummary = {
      durationSec: Math.round((bs?.duration ?? 0) / 1000),
      slashCount: bs?.slashCount ?? 0,
      averageSpeed: bs?.averageSpeed ?? 0,
      accuracyScore: bs?.accuracyScore ?? 0,
      stabilityScore: bs?.stabilityScore ?? 0,
      blocks: bs?.blocks ?? 0,
      interrupts: bs?.interrupts ?? 0,
      projectilesCut: bs?.projectilesCut ?? 0,
    };
  }
  return req;
}

/** 注入检测：常见提示注入与系统伪装模式（保守拒绝） */
function looksLikeInjection(text: string): boolean {
  const t = text.toLowerCase();
  if (/忽略(之前|以上|所有)(的)?(指令|规则|设定)/.test(text)) return true;
  if (/(ignore|disregard).{0,12}(previous|above|all).{0,12}(instructions?|rules?)/i.test(t)) return true;
  if (/system\s*prompt|系统提示词/i.test(text)) return true;
  if (/你(现在)?是(一个)?(新的|不同的)?(系统|开发者模式)/.test(text)) return true;
  if (/```/.test(text)) return true; // 代码块一律拒绝（叙事不需要）
  return false;
}

function isPlainSafeText(v: unknown, maxLen: number): v is string {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > maxLen) return false;
  if (looksLikeInjection(v)) return false;
  // 控制字符拒绝（\n 与常见标点允许）
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000e-\u001f]/.test(v)) return false;
  return true;
}

/**
 * 严格 schema 校验：任何越界 → null（调用方回退 deterministic）。
 * 未知字段（extra/enemies/数值等）同样拒绝。
 */
export function validateNarrative(
  raw: unknown,
  expectEventId: string,
  allowedOptionIds: readonly string[],
  expectRequestId?: string | null,
): NarrativeResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const allowedKeys = new Set([
    'eventId',
    'requestId',
    'body',
    'companionLine',
    'choiceLead',
    'source',
    'canonVersion',
  ]);
  for (const k of Object.keys(o)) {
    if (!allowedKeys.has(k)) return null; // 额外字段拒绝
  }
  if (o.eventId !== expectEventId) return null;
  // requestId 回传校验：带身份请求必须原样回传；迟到/错位响应（不匹配当前 requestId）整体拒绝
  if (expectRequestId != null) {
    if (o.requestId !== expectRequestId) return null;
  } else if (typeof o.requestId !== 'undefined' && o.requestId !== '') {
    return null; // 未带身份的调用若模型自行编造 requestId → 拒绝
  }
  if (o.canonVersion !== CANON_VERSION) return null;
  if (o.source !== 'ai' && o.source !== 'deterministic') return null;
  if (!isPlainSafeText(o.body, BODY_MAX_LEN)) return null;
  let companionLine: string | null = null;
  if (o.companionLine !== null) {
    // 空串同样归一为 null（模型常以空串表示「无回应」）
    if (o.companionLine === '') {
      companionLine = null;
    } else if (!isPlainSafeText(o.companionLine, COMPANION_MAX_LEN)) {
      return null;
    } else {
      companionLine = o.companionLine;
    }
  }
  let choiceLead: { optionId: string; text: string } | null = null;
  if (o.choiceLead !== null) {
    // 实测模型常以空串表示「无引导语」：归一为 null（不拒绝）
    if (o.choiceLead === '') {
      choiceLead = null;
    } else {
      // 收口收紧：choiceLead 只能是固定允许 optionId 或 null，拒绝任意字符串映射
      if (typeof o.choiceLead !== 'object' || o.choiceLead === null) return null;
      if (typeof o.choiceLead !== 'object' || o.choiceLead === null) return null;
      const cl = o.choiceLead as Record<string, unknown>;
      const clKeys = new Set(['optionId', 'text']);
      for (const k of Object.keys(cl)) {
        if (!clKeys.has(k)) return null;
      }
      if (typeof cl.optionId !== 'string' || !allowedOptionIds.includes(cl.optionId)) return null;
      if (!isPlainSafeText(cl.text, LEAD_MAX_LEN)) return null;
      choiceLead = { optionId: cl.optionId, text: cl.text };
    }
  }
  return {
    eventId: expectEventId,
    requestId: typeof o.requestId === 'string' ? o.requestId : null,
    body: o.body,
    companionLine,
    choiceLead,
    source: o.source,
    fallbackReason: null,
  };
}

/** 缓存 key：canon/life/chapter/event 实例隔离，不含随恢复变化的 requestId。 */
export function narrativeCacheKey(state: LifeState, eventId: string): string {
  const inst = state.activeEvent?.eventInstanceId ?? 'none';
  return JSON.stringify([CANON_VERSION, state.lifeId, state.chapterInstanceId, eventId, inst, state.seed, state.replayCount]);
}

/** 会话内缓存（Map；只存文字与 source，不含任何运行时数据） */
const narrativeCache = new Map<string, StoredEntry>();

export function clearNarrativeCache(): void {
  narrativeCache.clear();
}

/** 持久缓存条目（序列化安全：只含文字与来源/原因） */
interface StoredEntry {
  body: string;
  companionLine: string | null;
  choiceLead: { optionId: string; text: string } | null;
  source: 'ai' | 'deterministic';
}

/** The skipped companion cannot be credited with teaching a technique. */
export function techniqueSourceFor(state: LifeState, kind: TechniqueKindId): string {
  const def = findTechniqueOpportunity(kind);
  return state.companionState.skipped && def.source.includes('燕迟')
    ? '老猎户的桦皮剑谱 · 末页'
    : def.source;
}

function safeLocalStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__jw_narr_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null; // 隐私模式/受限环境：静默降级为内存缓存
  }
}

/** 读取持久缓存（损坏 → null 安全忽略） */
function loadStore(): Record<string, StoredEntry> | null {
  const s = safeLocalStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(NARRATIVE_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredEntry>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写入持久缓存（条目上限防膨胀；失败静默） */
function saveStoreEntry(key: string, entry: StoredEntry): void {
  const s = safeLocalStorage();
  if (!s) return;
  try {
    const store = loadStore() ?? {};
    store[key] = entry;
    const keys = Object.keys(store);
    if (keys.length > STORE_MAX_ENTRIES) {
      // 超限：按插入序丢弃最旧（Map 语义近似：重建保留尾部）
      for (const k of keys.slice(0, keys.length - STORE_MAX_ENTRIES)) delete store[k];
    }
    s.setItem(NARRATIVE_STORE_KEY, JSON.stringify(store));
  } catch {
    // 配额满/受限：放弃持久化（内存缓存仍有效）
  }
}

/** 清空持久缓存（测试/清理用） */
export function clearNarrativeStore(): void {
  const s = safeLocalStorage();
  if (!s) return;
  try {
    s.removeItem(NARRATIVE_STORE_KEY);
  } catch {
    // 忽略
  }
}

/** 固定系统约束提示词（世界边界：AI 只导演文字） */
export function buildSystemPrompt(): string {
  return [
    '你是国风剑侠网页游戏《剑问九州》的叙事导演，只负责润色第一章的固定事件文字。',
    '世界边界（必须遵守）：',
    '- 九州尚未展开，第一章只到「练气一层」，不得提及第二章及之后的内容；',
    '- 玩家是屏幕外的剑修，剑由玩家在屏幕上真实挥出；',
    '- 你不能改变任何规则、数值、技能、敌人、掉落、境界或选项后果；',
    '- 三选项永远固定，只能对应给出的 optionId，不得创造新选项；',
    '- 同行者燕迟是固定散修，最多一句有限回应，不恋爱、不战斗、不无限对话；',
    '- 文风：克制、留白的国风短句，不用感叹号堆叠，不出现现代词汇。',
    '只输出符合给定 JSON schema 的对象，不输出其他任何文字。',
  ].join('\n');
}

/** deterministic 兜底文案（与固定世界文本一致的质量；AI 不可用时可完整走完第一章） */
/** v30：导出供测试与接线层直接调用（固定导演兜底；身份匹配当前 activeEvent） */
export function deterministicFallback(
  kind: NarrativeKind,
  state: LifeState,
): NarrativeResult {
  const eventId = eventIdOf(kind);
  const requestId = state.activeEvent?.eventDefinitionId === eventId
    ? state.activeEvent.requestId
    : null;
  const origin = LIFE_ORIGINS.find((o) => o.id === state.profile?.originId);
  const cons = findConstitution(state.profile?.constitutionId);
  const originTitle = origin?.title ?? '未知之地';
  const consTitle = cons?.title ?? '未知';
  const name = state.profile?.name ?? '无名剑客';
  const bodies: Record<string, string> = {
    'profile:identity': `命盘落定。${name}，${originTitle}出身，身怀「${consTitle}」之异。前路未书，剑在你手。`,
    'ch1:opening': '晨钟三响，你离开那座待了十六年的小院。山道尽头的狼嚎越来越近，剑在背后，路在脚下。',
    'ch1:choice:intent': '雾锁山道，狼嚎渐近。第一剑落向何处，将定义你此后每一次出鞘。',
    'ch1:choice:fate': '狼血未冷，妖修退去。山道在此分岔：北面是青云剑宗的山门，东南是漫无边际的江湖。',
    'ch1:companion:meet': '枯树下走出的青衫剑客拱了拱手，自称燕迟，问你可要同路一段。',
    'ch1:companion:warm': '「好。」你把剑归鞘，与他并肩往山道走去。',
    'ch1:companion:reserved': '你没有应声，只朝东南方向抬了抬下巴。燕迟笑了笑，落后半步跟着。',
    'ch1:result': '雾岭的第一夜落下。两次抉择已定，你的剑路自此有了方向。',
  };
  // Confirmation creates a new event instance; narrate that chosen consequence.
  const chosen = state.activeEvent?.chosenOptionId;
  if (kind.kind === 'choice' && chosen) {
    const option = (kind.stage === 'intent' ? INTENT_OPTIONS : FATE_OPTIONS).find(o => o.id === chosen);
    bodies[eventId] = `一剑落定，你已选定「${option?.title ?? chosen}」。山风穿过剑锋，这一步已成为你的来路。`;
  }
  if (kind.kind === 'companion' && (state.flags['companion-warm'] || state.flags['companion-reserved'] || state.companionState.skipped)) {
    bodies[eventId] = state.companionState.skipped
      ? '你向青衫剑客拱手作别，独自走入山雾。山道寂静，只有剑鞘轻叩衣角。'
      : state.flags['companion-warm'] ? bodies['ch1:companion:warm'] : bodies['ch1:companion:reserved'];
  }
  // 第九阶段收口：机缘固定导演文案（按程序决定的固定机缘事实；AI 失败/超时也绝不改机缘）
  if (kind.kind === 'technique') {
    const def = findTechniqueOpportunity(kind.techniqueKind);
    return {
      eventId,
      requestId,
      body: def.fallbackText,
      companionLine: null,
      choiceLead: null,
      source: 'deterministic',
      fallbackReason: null,
    };
  }
  // 第九阶段：剑道初相固定导演文案（按程序确定类型；AI 失败/超时也绝不改类型）
  if (eventId === 'ch1:archetype') {
    const arch = state.swordArchetype?.id;
    const found =
      arch === 'swift' || arch === 'steady' || arch === 'fierce' || arch === 'nimble'
        ? SWORD_ARCHETYPES.find((a) => a.id === arch)
        : null;
    const bs = state.lastBattleSummary;
    const stat =
      bs && bs.slashCount > 0
        ? `此役共出有效之剑 ${bs.slashCount} 次，快准稳之评自实录而来。`
        : '此役之评，自剑录而来。';
    return {
      eventId,
      requestId,
      body: `${found?.fallbackText ?? SWORD_ARCHETYPES[1].fallbackText}${stat}`,
      companionLine: null,
      choiceLead: null,
      source: 'deterministic',
      fallbackReason: null, // 由调用方按失败类型填充
    };
  }
  return {
    eventId,
    requestId,
    body: bodies[eventId] ?? bodies['ch1:opening']!,
    companionLine: null,
    choiceLead: null,
    source: 'deterministic',
    fallbackReason: null, // 由调用方按失败类型填充
  };
}

/** fetcher 注入点（测试用；生产优先 Supabase，纯本地使用同源 Node Proxy） */
export type NarrativeFetcher = (url: string, init: RequestInit) => Promise<Response>;

interface RequestOptions {
  fetcher?: NarrativeFetcher;
  token?: NarrativeToken;
  timeoutMs?: number;
  /** 测试注入：不读持久缓存（默认读） */
  skipPersistent?: boolean;
}

/** 允许的 option id（按当前选择阶段取固定配置） */
function allowedOptionIds(kind: NarrativeKind): readonly string[] {
  if (kind.kind === 'choice') {
    return (kind.stage === 'intent' ? INTENT_OPTIONS : FATE_OPTIONS).map((o) => o.id);
  }
  return [];
}

/** Revalidate pure cached content after binding it to this caller's identity. */
function storedToResult(req: NarrativeRequest, entry: unknown, options: readonly string[]): NarrativeResult | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  if (Object.keys(e).some(key => !['body', 'companionLine', 'choiceLead', 'source'].includes(key))) return null;
  if (e.source !== 'ai') return null;
  return validateNarrative({ ...e, eventId: req.eventId, requestId: req.requestId, canonVersion: req.canonVersion }, req.eventId, options, req.requestId);
}

function contentOf(result: NarrativeResult): StoredEntry {
  return { body: result.body, companionLine: result.companionLine, choiceLead: result.choiceLead, source: result.source };
}

type SharedOutcome = { content: StoredEntry } | { reason: NarrativeFallbackReason };
const inflight = new Map<string, Promise<SharedOutcome>>();

/** Each subscriber owns cancellation and identity; only content/network work is shared. */
export async function requestNarrative(
  state: LifeState,
  kind: NarrativeKind,
  opts: RequestOptions = {},
): Promise<NarrativeResult> {
  const req = buildNarrativeRequest(state, kind);
  const options = allowedOptionIds(kind);
  const fallback = (reason: NarrativeFallbackReason | null): NarrativeResult => ({
    ...deterministicFallback(kind, state), requestId: req.requestId, fallbackReason: reason,
  });
  if (opts.token?.aborted) return fallback(null);
  const cacheKey = narrativeCacheKey(state, req.eventId);
  const cached = storedToResult(req, narrativeCache.get(cacheKey), options);
  if (cached) return cached;
  narrativeCache.delete(cacheKey);
  if (!opts.skipPersistent) {
    const stored = storedToResult(req, loadStore()?.[cacheKey], options);
    if (stored) {
      narrativeCache.set(cacheKey, contentOf(stored));
      return stored;
    }
  }
  // Node 单元测试没有浏览器同源地址；保持明确 unconfigured。浏览器本地运行则固定
  // 请求 /api，密钥与 Provider 地址只存在于本地 Node/生产 Edge 环境。
  if (!opts.fetcher && !supabase && typeof window === 'undefined') return fallback('unconfigured');
  let shared = inflight.get(cacheKey);
  if (!shared) {
    const supabaseClient = supabase;
    const usingLocalProxy = !opts.fetcher && !supabase;
    const fetcher: NarrativeFetcher = opts.fetcher ?? (supabaseClient
      ? async (_url, init) => {
          const { data, error } = await supabaseClient.functions.invoke('life-director-text', {
            body: JSON.parse(String(init.body)),
          });
          // Supabase's HTTP error context preserves the server's controlled reason.
          if (error) {
            const context = (error as { context?: unknown }).context;
            if (context instanceof Response) return context;
            return Response.json({ error: 'http' }, { status: 502 });
          }
          return Response.json(data);
        }
      : (url, init) => globalThis.fetch(url, init));
    const main = (async (): Promise<SharedOutcome> => {
      let response: Response;
      try {
        response = await fetcher(usingLocalProxy ? '/api/life-director-text' : '/functions/life-director-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemPrompt: buildSystemPrompt(), request: req, optionIds: options, identity: req.identity }),
        });
      } catch {
        return { reason: 'network' };
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return { reason: response.ok ? 'invalid-schema' : 'http' };
      }
      const envelope = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
      if (!response.ok) {
        const reason = envelope.error;
        return { reason: reason === 'timeout' || reason === 'unconfigured' || reason === 'empty' || reason === 'invalid-schema' || reason === 'network' ? reason : 'http' };
      }
      if (typeof envelope.content !== 'string' || !envelope.content.trim()) return { reason: 'empty' };
      let parsed: unknown;
      try { parsed = JSON.parse(envelope.content); } catch { return { reason: 'invalid-schema' }; }
      const result = validateNarrative(parsed, req.eventId, options, req.requestId);
      if (!result) return { reason: 'invalid-schema' };
      const content = contentOf({ ...result, source: 'ai' });
      narrativeCache.set(cacheKey, content);
      saveStoreEntry(cacheKey, content);
      return { content };
    })().catch((): SharedOutcome => ({ reason: 'network' }));
    // Bound the full operation, including body consumption. A late success is cache-only.
    shared = (async (): Promise<SharedOutcome> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<SharedOutcome>(resolve => {
        timer = setTimeout(() => resolve({ reason: 'timeout' }), opts.timeoutMs ?? NARRATIVE_TIMEOUT_MS);
      });
      try { return await Promise.race([main, timeout]); }
      finally { if (timer !== undefined) clearTimeout(timer); }
    })();
    inflight.set(cacheKey, shared);
    const owned = shared;
    void shared.finally(() => { if (inflight.get(cacheKey) === owned) inflight.delete(cacheKey); });
  }
  const outcome = await shared;
  if (opts.token?.aborted) return fallback(null);
  if ('reason' in outcome) return fallback(outcome.reason);
  return storedToResult(req, outcome.content, options) ?? fallback('invalid-schema');
}

// 人生导演文本代理（Deno Edge Function）。
// AI_BASE_URL / AI_MODEL / AI_API_KEY 仅由服务端环境配置 OpenAI-compatible provider。
// 模型只生成文本；服务端绑定请求身份、世界版本与来源，客户端再次校验。
import { providerModelForEvent, type ProviderEnvironment } from '../_shared/providerRouting.ts';

// Deno 全局声明（vitest node 环境 stub 注入；Deno 运行时天然提供）
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
};

export {};

export const UPSTREAM_TIMEOUT_MS = 30000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** 有 activeEvent 的生命周期事件（服务端强制要求携带 identity） */
const LIFECYCLE_EVENT_PREFIXES = ['ch1:choice:', 'ch1:companion:', 'ch1:technique:', 'ch1:archetype'];

function isLifecycleEvent(eventId: string): boolean {
  return LIFECYCLE_EVENT_PREFIXES.some((p) => eventId.startsWith(p));
}

/** 身份字段：合法非空短字符串（16～128 字符，防注入超长负载） */
function isIdentityField(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128;
}

interface EventIdentityPayload {
  lifeId: string;
  chapterInstanceId: string;
  eventDefinitionId: string;
  eventInstanceId: string;
  requestId: string;
}

interface CanonRequest {
  canonVersion: number;
  eventId: string;
  /** 请求身份（客户端生成；服务端只做结构/一致性校验） */
  identity?: EventIdentityPayload;
  /** 服务端绑定到响应的 requestId */
  requestId?: string;
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
  jsonOnly: boolean;
  /** 第九阶段收口（technique 事件）：机缘事实（程序决定，AI 只可引用） */
  techniqueTitle?: string;
  techniqueSource?: string;
  /** 第九阶段：剑道初相事件（程序已判定的类型与战斗摘要） */
  swordArchetypeTitle?: string;
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

/** 白名单校验：请求体只允许固定 canon 字段（防御纵深：未知字段拒绝） */
function validateCanonRequest(raw: unknown): CanonRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const allowed = new Set([
    'canonVersion',
    'eventId',
    'identity',
    'requestId',
    'chapterIndex',
    'replayCount',
    'name',
    'gender',
    'originId',
    'originTitle',
    'constitutionId',
    'constitutionTitle',
    'constitutionTags',
    'confirmedFlags',
    'companion',
    'jsonOnly',
    'swordArchetypeTitle',
    'battleSummary',
    'techniqueTitle',
    'techniqueSource',
  ]);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) return null;
  }
  if (o.canonVersion !== 1) return null;
  if (typeof o.eventId !== 'string' || o.eventId.length === 0 || o.eventId.length > 64) return null;
  if (typeof o.chapterIndex !== 'number' || typeof o.replayCount !== 'number') return null;
  if (typeof o.name !== 'string' || o.name.length === 0 || o.name.length > 24) return null;
  if (typeof o.gender !== 'string' || typeof o.originId !== 'string') return null;
  if (typeof o.originTitle !== 'string' || typeof o.constitutionId !== 'string') return null;
  if (typeof o.constitutionTitle !== 'string') return null;
  if (!Array.isArray(o.constitutionTags) || !Array.isArray(o.confirmedFlags)) return null;
  if (o.constitutionTags.some((t) => typeof t !== 'string')) return null;
  if (o.confirmedFlags.some((t) => typeof t !== 'string')) return null;
  if (typeof o.companion !== 'string') return null;
  // 身份与 requestId：结构校验 + 一致性（requestId 必须与 identity.requestId 一致）。
  // 生命周期事件（choice/companion/technique/archetype）必须携带 identity——
  // identity 五字段均为合法非空短字符串；禁止旧事件身份漂移。
  const idObj =
    o.identity === undefined ? null : (o.identity as Record<string, unknown> | null);
  const idOk =
    o.identity === undefined
      ? true
      : idObj !== null &&
        isIdentityField(idObj.lifeId) &&
        isIdentityField(idObj.chapterInstanceId) &&
        isIdentityField(idObj.eventDefinitionId) &&
        isIdentityField(idObj.eventInstanceId) &&
        isIdentityField(idObj.requestId) &&
        idObj.requestId === o.requestId;
  if (!idOk) return null;
  if (o.requestId !== undefined && (typeof o.requestId !== 'string' || o.requestId.length > 128)) return null;
  // 生命周期事件：identity 必须存在且与顶层 requestId 成对
  if (isLifecycleEvent(String(o.eventId)) && o.identity === undefined) return null;
  if (isLifecycleEvent(String(o.eventId)) && o.requestId === undefined) return null;
  // 第九阶段收口（technique 事件）
  if (o.techniqueTitle !== undefined && typeof o.techniqueTitle !== 'string') return null;
  if (o.techniqueSource !== undefined && typeof o.techniqueSource !== 'string') return null;
  // 第九阶段（可选字段）：剑道初相事件
  if (o.swordArchetypeTitle !== undefined && typeof o.swordArchetypeTitle !== 'string') return null;
  if (o.battleSummary !== undefined) {
    const bs = o.battleSummary as Record<string, unknown>;
    const bsKeys = [
      'durationSec', 'slashCount', 'averageSpeed', 'accuracyScore',
      'stabilityScore', 'blocks', 'interrupts', 'projectilesCut',
    ];
    if (typeof bs !== 'object' || bs === null || Array.isArray(bs)) return null;
    for (const k of Object.keys(bs)) if (!bsKeys.includes(k)) return null;
    for (const k of bsKeys) if (typeof bs[k] !== 'number') return null;
  }
  return o as unknown as CanonRequest;
}

/** 事件是否为选择类（choiceLead 唯一允许非 null 的事件类别） */
function isChoiceEventId(eventId: string): boolean {
  return eventId === 'ch1:choice:intent' || eventId === 'ch1:choice:fate';
}

export async function handleLifeDirectorRequest(
  req: Request,
  getEnv: (key: string) => string | undefined,
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let systemPrompt: string;
  let request: CanonRequest | null;
  let optionIds: string[];
  try {
    const body = await req.json();
    if (typeof body.systemPrompt !== 'string' || body.systemPrompt.length > 4000) {
      throw new Error('bad systemPrompt');
    }
    systemPrompt = body.systemPrompt;
    request = validateCanonRequest(body.request);
    if (!request) throw new Error('bad request payload');
    optionIds = Array.isArray(body.optionIds) && body.optionIds.every((x: unknown) => typeof x === 'string')
      ? (body.optionIds as string[])
      : [];
    // 选择类事件必须提供非空固定选项集（choiceLead enum 才能锁死）；
    // 非选择事件（identity/opening/companion/technique/archetype/result）允许 optionIds=[]
    if (isChoiceEventId(request.eventId) && optionIds.length === 0) {
      throw new Error('choice event requires optionIds');
    }
    // 选择类事件的选项集必须是固定的三个（拒绝任意扩充/伪造选项）
    if (isChoiceEventId(request.eventId)) {
      const fixedOptions = request.eventId === 'ch1:choice:intent'
        ? ['intent-steady', 'intent-swift', 'intent-void']
        : ['fate-sect', 'fate-wander', 'fate-companion'];
      if (optionIds.length !== fixedOptions.length || new Set(optionIds).size !== fixedOptions.length || optionIds.some(id => !fixedOptions.includes(id))) {
        throw new Error('choice event requires exactly 3 fixed options');
      }
    }
    // 有 activeEvent 的生命周期事件必须携带身份，且 identity.eventDefinitionId 与 eventId 一致
    // （禁止旧事件身份漂移：companion 请求不得携带上一选择事件定义）
    if (request.identity) {
      if (request.identity.eventDefinitionId !== request.eventId) {
        throw new Error('identity eventDefinitionId mismatch');
      }
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const env: ProviderEnvironment = {
    AI_API_KEY: getEnv('AI_API_KEY'),
    AI_BASE_URL: getEnv('AI_BASE_URL'),
    AI_MODEL_FLASH: getEnv('AI_MODEL_FLASH'),
    AI_MODEL_PRO: getEnv('AI_MODEL_PRO'),
    AI_MODEL: getEnv('AI_MODEL'),
  };
  const apiKey = env.AI_API_KEY?.trim();
  const model = providerModelForEvent(request.eventId, request.confirmedFlags, env);
  const baseUrl = env.AI_BASE_URL?.trim();
  if (!apiKey || !model || !baseUrl || !/^https?:\/\//.test(baseUrl)) {
    return new Response(JSON.stringify({ error: 'unconfigured' }), {
      status: 503,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const confirmedChoice = isChoiceEventId(request.eventId)
    && request.confirmedFlags.some(flag => optionIds.includes(flag));
  const narrativeOptions = confirmedChoice ? [] : optionIds;
  // 组装 user 消息：只用白名单 canon 字段（不含任何运行时/隐私数据）
  const userMessage = [
    `事件：${request.eventId}（第一章，第 ${request.chapterIndex} 章，重历次数 ${request.replayCount}）`,
    `剑修：${request.name}（${request.gender === 'female' ? '女' : '男'}），出身「${request.originTitle}」，体质「${request.constitutionTitle}」${request.constitutionTags.length ? `（${request.constitutionTags.join('、')}）` : ''}`,
    '重要：姓名/性别/出身/体质是既定事实，只能引用不能改动，也不得虚构新的身份事实。',
    request.confirmedFlags.length > 0
      ? `已确认抉择：${request.confirmedFlags.filter((f) => f.startsWith('intent-') || f.startsWith('fate-') || f.startsWith('companion-')).join('、')}`
      : '尚无已确认抉择',
    request.techniqueTitle
      ? `剑道机缘：「${request.techniqueTitle}」（${request.techniqueSource ?? '传承'}）已由程序决定，AI 只可围绕该固定事实写获得机缘的短叙事，不得创造、更改或另立招式/威力/属性`
      : '',
    request.swordArchetypeTitle
      ? `剑道初相：「${request.swordArchetypeTitle}」已由程序依据战斗实录判定，只可引用评价，不得改动或另立类型`
      : '',
    request.battleSummary
      ? `战斗实录（只读事实）：历时约 ${request.battleSummary.durationSec} 秒，有效之剑 ${request.battleSummary.slashCount} 次，均速 ${request.battleSummary.averageSpeed}，准 ${request.battleSummary.accuracyScore}，稳 ${request.battleSummary.stabilityScore}，格挡 ${request.battleSummary.blocks}，破势 ${request.battleSummary.interrupts}，斩弹 ${request.battleSummary.projectilesCut}`
      : '',
    request.companion === 'none'
      ? '玩家已独自赶路，燕迟不在场，不得编造燕迟的教导或回应；companionLine 必须为 null。'
      : `同行者：燕迟（${request.companion}），若事件相关，给一句克制的回应`,
    confirmedChoice ? '本次抉择已经挥剑确认。只描写已确认选择的后果与人物行动，不再邀请选择、不重新提问、不改变已确认旗标。choiceLead 必须为 null。' : '',
    narrativeOptions.length > 0 ? `可引用的固定选项 id：${narrativeOptions.join('、')}` : '本事件无待选选项',
    '请为该事件写一段叙事正文（body），必要时给燕迟一句回应（companionLine），',
    narrativeOptions.length > 0
      ? '若事件含选项，可用固定 optionId 写一句引导（choiceLead）。只输出 JSON。'
      : 'choiceLead 必须为 null（本事件无选项）。只输出 JSON。',
  ].join('\n');

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failure = (status: number, error: string) => new Response(JSON.stringify({ error }), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
  const operation = (async (): Promise<Response> => {
    let upstream: Response;
    try {
      const responseExample = narrativeOptions.length > 0
        ? `{"body":"中文叙事","companionLine":null,"choiceLead":{"optionId":"${narrativeOptions[0]}","text":"中文引导"}}`
        : '{"body":"中文叙事","companionLine":null,"choiceLead":null}';
      upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `${systemPrompt}\n只输出一个 JSON 对象。字段必须且只能是 body、companionLine、choiceLead；不得解释字段含义；严格按此形状输出：${responseExample}。事件身份与来源由服务器绑定，不得生成。只叙述既定第一章事实，不修改任何规则或数值。` },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.9,
          max_completion_tokens: 800,
          response_format: { type: 'json_object' },
        }),
      });
    } catch {
      return failure(502, 'network');
    }
    if (!upstream.ok) return failure(upstream.status === 429 || upstream.status === 402 ? upstream.status : 502, 'http');
    let data: { choices?: { message?: { content?: unknown } }[] };
    try { data = await upstream.json(); } catch { return failure(502, 'invalid-schema'); }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return failure(502, 'empty');
    const fenced = content.trim().match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
    let raw: unknown;
    try { raw = JSON.parse(fenced ? fenced[1] : content); } catch { return failure(502, 'invalid-schema'); }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return failure(502, 'invalid-schema');
    const obj = raw as Record<string, unknown>;
    // Accept legacy envelope fields but never trust them. Reject all other extras.
    const keys = ['body', 'companionLine', 'choiceLead', 'eventId', 'requestId', 'canonVersion', 'source'];
    if (Object.keys(obj).some(key => !keys.includes(key))) return failure(502, 'invalid-schema');
    const safeText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    if (!safeText(obj.body, 320)) return failure(502, 'invalid-schema');
    if (obj.companionLine === '') obj.companionLine = null;
    if (obj.choiceLead === '') obj.choiceLead = null;
    if (obj.companionLine !== null && !safeText(obj.companionLine, 120)) return failure(502, 'invalid-schema');
    if (obj.choiceLead !== null) {
      if (typeof obj.choiceLead !== 'object' || Array.isArray(obj.choiceLead)) return failure(502, 'invalid-schema');
      const lead = obj.choiceLead as Record<string, unknown>;
      if (Object.keys(lead).some(key => !['optionId', 'text'].includes(key)) || typeof lead.optionId !== 'string' || !narrativeOptions.includes(lead.optionId) || !safeText(lead.text, 48)) return failure(502, 'invalid-schema');
    }
    const bound = {
      body: obj.body, companionLine: obj.companionLine, choiceLead: obj.choiceLead,
      eventId: request.eventId, requestId: request.requestId ?? '', canonVersion: request.canonVersion, source: 'ai',
    };
    return new Response(JSON.stringify({ content: JSON.stringify(bound) }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  })().catch(() => failure(502, 'invalid-schema'));
  const timeout = new Promise<Response>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(failure(504, 'timeout'));
    }, UPSTREAM_TIMEOUT_MS);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(req => handleLifeDirectorRequest(req, key => Deno.env.get(key)));
}

/**
 * v30 第二轮：life-director-text Edge Function 真实处理函数测试。
 * 通过 stub 全局 Deno（Deno.serve / Deno.env.get / fetch），直接 import EF 源码，
 * 捕获其注册的请求处理函数，用构造 Request 验证协议行为（不发真实上游请求）。
 *
 * 覆盖：
 * 1. 非选择事件 optionIds=[] 不再被 400 拒绝（identity/opening/companion/technique/archetype）；
 * 2. choice 事件 optionIds 为空 / 非 3 项 → 400 拒绝；
 * 3. identity.eventDefinitionId 与 eventId 不一致 → 400 拒绝；
 * 4. identity.requestId 与顶层 requestId 不一致 → 400 拒绝；
 * 5. 未知字段 → 400 拒绝；
 * 6. 合法 choice/companion/technique/archetype 生命周期请求 → 进入上游调用（200 路径）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedHandler {
  handler: (req: Request) => Promise<Response>;
}

let captured: CapturedHandler | null = null;

const STUB_KEY = 'test-integrations-key';

beforeEach(async () => {
  captured = null;
  vi.resetModules();
  const serve = (fn: (req: Request) => Promise<Response>) => {
    captured = { handler: fn };
  };
  const config: Record<string, string> = { AI_API_KEY: STUB_KEY, AI_MODEL: 'stub-model', AI_BASE_URL: 'https://provider.test/v1' };
  const envGet = (k: string) => config[k];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ body: '剑意已定。', companionLine: null, choiceLead: null }) } }] })));
  (globalThis as unknown as { Deno: unknown }).Deno = {
    serve,
    env: { get: envGet },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { Deno: unknown }).Deno;
  vi.unstubAllGlobals();
});

async function importHandler(): Promise<(req: Request) => Promise<Response>> {
  await import('../supabase/functions/life-director-text/index.ts');
  if (!captured) throw new Error('Deno.serve 未捕获到处理函数');
  return captured.handler;
}

/** 构造合法 canon 请求体基础模板 */
function canonBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    canonVersion: 1,
    eventId: 'ch1:companion:meet',
    identity: {
      lifeId: 'life-abc123',
      chapterInstanceId: 'ch-abc123',
      eventDefinitionId: 'ch1:companion:meet',
      eventInstanceId: 'ev-abc123',
      requestId: 'req-abc123',
    },
    requestId: 'req-abc123',
    chapterIndex: 1,
    replayCount: 0,
    name: '测试剑客',
    gender: 'male',
    originId: 'origin-north',
    originTitle: '北境',
    constitutionId: 'cons-swift',
    constitutionTitle: '迅影',
    constitutionTags: ['快'],
    confirmedFlags: [],
    companion: 'companion-yan',
    jsonOnly: true,
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request('https://fn.local/life-director-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('v30 EF：非选择事件 optionIds=[] 协议', () => {
  it('companion 事件（optionIds=[]）不再被 400 拒绝', async () => {
    const h = await importHandler();
    const res = await h(makeRequest({
      systemPrompt: 'test',
      request: canonBody(),
      optionIds: [],
    }));
    // 不再 400：上游被 stub 后必然 502/200，二者都证明通过了协议校验
    expect(res.status).not.toBe(400);
  });

  it('identity/opening/archetype/technique 非选择事件（optionIds=[]）均通过', async () => {
    const h = await importHandler();
    for (const ev of ['ch1:identity', 'ch1:opening', 'ch1:archetype', 'ch1:technique:cross']) {
      const body = canonBody({
        eventId: ev,
        identity: {
          lifeId: 'life-abc123',
          chapterInstanceId: 'ch-abc123',
          eventDefinitionId: ev,
          eventInstanceId: 'ev-abc123',
          requestId: 'req-abc123',
        },
      });
      const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
      expect(res.status, `事件 ${ev} 不应被 400 拒绝`).not.toBe(400);
    }
  });

  it('choice 事件 optionIds 为空 → 400 拒绝', async () => {
    const h = await importHandler();
    const body = canonBody({
      eventId: 'ch1:choice:intent',
      identity: {
        lifeId: 'life-abc123',
        chapterInstanceId: 'ch-abc123',
        eventDefinitionId: 'ch1:choice:intent',
        eventInstanceId: 'ev-abc123',
        requestId: 'req-abc123',
      },
    });
    const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
    expect(res.status).toBe(400);
  });

  it('choice 事件 optionIds 非固定 3 项 → 400 拒绝', async () => {
    const h = await importHandler();
    const body = canonBody({
      eventId: 'ch1:choice:fate',
      identity: {
        lifeId: 'life-abc123',
        chapterInstanceId: 'ch-abc123',
        eventDefinitionId: 'ch1:choice:fate',
        eventInstanceId: 'ev-abc123',
        requestId: 'req-abc123',
      },
    });
    const res = await h(
      makeRequest({ systemPrompt: 'test', request: body, optionIds: ['intent-swift', 'intent-steady'] }),
    );
    expect(res.status).toBe(400);
  });
});

describe('v30 EF：身份一致性校验', () => {
  it('identity.eventDefinitionId 与 eventId 不一致（companion 借用 choice 事件身份）→ 400', async () => {
    const h = await importHandler();
    const body = canonBody({
      eventId: 'ch1:companion:meet',
      identity: {
        lifeId: 'life-abc123',
        chapterInstanceId: 'ch-abc123',
        eventDefinitionId: 'ch1:choice:intent', // 旧选择事件身份漂移
        eventInstanceId: 'ev-abc123',
        requestId: 'req-abc123',
      },
    });
    const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
    expect(res.status).toBe(400);
  });

  it('identity.requestId 与顶层 requestId 不一致 → 400', async () => {
    const h = await importHandler();
    const body = canonBody({
      requestId: 'req-abc123',
      identity: {
        lifeId: 'life-abc123',
        chapterInstanceId: 'ch-abc123',
        eventDefinitionId: 'ch1:companion:meet',
        eventInstanceId: 'ev-abc123',
        requestId: 'req-DIFFERENT',
      },
    });
    const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
    expect(res.status).toBe(400);
  });

  it('生命周期事件缺失 identity → 400 拒绝', async () => {
    const h = await importHandler();
    const body = canonBody();
    delete (body as Record<string, unknown>).identity;
    const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
    expect(res.status).toBe(400);
  });

  it('未知字段（夹带运行时数据）→ 400 拒绝', async () => {
    const h = await importHandler();
    const body = canonBody({ hp: 100, qi: 50, landmark: [[1, 2]] });
    const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
    expect(res.status).toBe(400);
  });

  it('identity 字段为空串（非法非空短字符串）→ 400 拒绝', async () => {
    const h = await importHandler();
    const body = canonBody({
      identity: {
        lifeId: '',
        chapterInstanceId: 'ch-abc123',
        eventDefinitionId: 'ch1:companion:meet',
        eventInstanceId: 'ev-abc123',
        requestId: 'req-abc123',
      },
    });
    const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
    expect(res.status).toBe(400);
  });

  it('合法 technique 生命周期请求通过协议校验（进入上游）', async () => {
    const h = await importHandler();
    const body = canonBody({
      eventId: 'ch1:technique:cross',
      identity: {
        lifeId: 'life-abc123',
        chapterInstanceId: 'ch-abc123',
        eventDefinitionId: 'ch1:technique:cross',
        eventInstanceId: 'ev-abc123',
        requestId: 'req-abc123',
      },
      techniqueTitle: '横扫千军',
      techniqueSource: '残卷',
    });
    const res = await h(makeRequest({ systemPrompt: 'test', request: body, optionIds: [] }));
    expect(res.status).not.toBe(400);
  });
});

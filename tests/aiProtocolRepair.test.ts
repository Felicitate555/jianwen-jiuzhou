import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';
import { buildNarrativeRequest, clearNarrativeCache, clearNarrativeStore, narrativeCacheKey, NARRATIVE_STORE_KEY, NARRATIVE_TIMEOUT_MS, requestNarrative, techniqueSourceFor } from '@/life/aiNarrative';

vi.mock('@/db/supabase', () => ({ supabase: null }));
const kind = { kind: 'identity' } as const;
function state() {
  const engine = new LifeEngine();
  engine.loadSeed(1234);
  engine.selectGender('male', 1);
  engine.generateIdentity(2);
  return structuredClone(engine.getState());
}
function reply(requestId: string) {
  return Response.json({ content: JSON.stringify({ eventId: 'profile:identity', requestId, canonVersion: 1, source: 'ai', body: '山风入袖，命盘已定。', companionLine: null, choiceLead: null }) });
}
beforeEach(() => { clearNarrativeCache(); clearNarrativeStore(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('AI request identity repair', () => {
  it('stores no request identity and revalidates persisted content after a reload', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    const current = state();
    const fetcher = vi.fn(async () => reply(current.activeEvent!.requestId));
    await requestNarrative(current, kind, { fetcher });
    const persisted = storage.get(NARRATIVE_STORE_KEY)!;
    expect(persisted).not.toContain('requestId');
    clearNarrativeCache();
    current.activeEvent!.requestId = 'req:reload';
    expect((await requestNarrative(current, kind, { fetcher })).requestId).toBe('req:reload');
    expect(fetcher).toHaveBeenCalledTimes(1);
    clearNarrativeCache();
    const tampered = JSON.parse(persisted);
    tampered[narrativeCacheKey(current, 'profile:identity')].choiceLead = { optionId: 'invented-option', text: '越界' };
    storage.set(NARRATIVE_STORE_KEY, JSON.stringify(tampered));
    expect((await requestNarrative(current, kind, { fetcher })).source).toBe('ai');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rebinds cached content to the active request and isolates lives and chapters', async () => {
    const first = state();
    const fetcher = vi.fn(async () => reply(first.activeEvent!.requestId));
    await requestNarrative(first, kind, { fetcher });
    const resumed = structuredClone(first);
    resumed.activeEvent!.requestId = 'req:resumed';
    expect(narrativeCacheKey(resumed, 'profile:identity')).toBe(narrativeCacheKey(first, 'profile:identity'));
    expect((await requestNarrative(resumed, kind, { fetcher })).requestId).toBe('req:resumed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    resumed.lifeId += ':other';
    expect(narrativeCacheKey(resumed, 'profile:identity')).not.toBe(narrativeCacheKey(first, 'profile:identity'));
    resumed.lifeId = first.lifeId;
    resumed.chapterInstanceId += ':other';
    expect(narrativeCacheKey(resumed, 'profile:identity')).not.toBe(narrativeCacheKey(first, 'profile:identity'));
  });
  it('shares upstream work without sharing cancellation or response identities', async () => {
    const first = state();
    const second = structuredClone(first);
    second.activeEvent!.requestId = 'req:second';
    let release!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const token = { aborted: false };
    const pendingFirst = requestNarrative(first, kind, { fetcher, token });
    token.aborted = true;
    const pendingSecond = requestNarrative(second, kind, { fetcher });
    release(reply(first.activeEvent!.requestId));
    const [a, b] = await Promise.all([pendingFirst, pendingSecond]);
    expect(a.source).toBe('deterministic');
    expect(b.source).toBe('ai');
    expect(b.requestId).toBe('req:second');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('accepts slow success within the AI-first window and isolates event instances', async () => {
    vi.useFakeTimers();
    const current = state();
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {
      setTimeout(() => resolve(reply(current.activeEvent!.requestId)), 12000);
    }));
    const pending = requestNarrative(current, kind, { fetcher });
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).source).toBe('ai');
    const next = structuredClone(current);
    next.activeEvent!.eventInstanceId += ':next';
    const second = requestNarrative(next, kind, { fetcher });
    await vi.advanceTimersByTimeAsync(12000);
    expect((await second).source).toBe('ai');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('malformed outer JSON and a stalled body both settle into fallback', async () => {
    const current = state();
    await expect(requestNarrative(current, kind, { fetcher: async () => new Response('bad json') })).resolves.toMatchObject({ fallbackReason: 'invalid-schema' });
    vi.useFakeTimers();
    const pending = requestNarrative(current, kind, { timeoutMs: 20, fetcher: async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response });
    await vi.advanceTimersByTimeAsync(21);
    expect((await pending).fallbackReason).toBe('timeout');
  });
  it('unconfigured frontend remains playable with an explicit fallback', async () => {
    expect((await requestNarrative(state(), kind)).fallbackReason).toBe('unconfigured');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const db = await vi.importActual<typeof import('@/db/supabase')>('@/db/supabase');
    expect(db.supabase).toBeNull();
    expect(NARRATIVE_TIMEOUT_MS).toBe(35000);
  });
  it.each([
    ['network', async () => { throw new Error('offline'); }],
    ['http', async () => new Response('unavailable', { status: 502 })],
    ['empty', async () => Response.json({ content: '' })],
    ['invalid-schema', async () => Response.json({ content: '{bad' })],
    ['invalid-schema', async () => Response.json({ content: JSON.stringify({ body: 'only body' }) })],
    ['invalid-schema', async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body));
      return Response.json({ content: JSON.stringify({ eventId: sent.request.eventId, requestId: sent.request.requestId, canonVersion: 1, source: 'ai', body: '   ', companionLine: null, choiceLead: null }) });
    }],
  ] as const)('settles %s failures without throwing', async (reason, fetcher) => {
    await expect(requestNarrative(state(), kind, { fetcher })).resolves.toMatchObject({ source: 'deterministic', fallbackReason: reason });
  });
});

async function server(configured = true) {
  let handler!: (request: Request) => Promise<Response>;
  const env: Record<string, string> = configured ? { AI_BASE_URL: 'https://provider.test/v1', AI_MODEL: 'stub-model', AI_API_KEY: 'stub-key' } : {};
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] }, serve: (fn: typeof handler) => { handler = fn; } });
  vi.resetModules();
  await import('../supabase/functions/life-director-text/index.ts');
  return handler;
}
function input() {
  return new Request('https://edge.test', { method: 'POST', body: JSON.stringify({ systemPrompt: '固定世界叙事', request: buildNarrativeRequest(state(), kind), optionIds: [] }) });
}
describe('AI provider boundary', () => {
  it.each([
    ['network', async () => { throw new Error('offline'); }],
    ['http', async () => new Response('provider failure', { status: 500 })],
    ['empty', async () => Response.json({ choices: [] })],
    ['invalid-schema', async () => new Response('bad JSON')],
    ['invalid-schema', async () => Response.json({ choices: [{ message: { content: JSON.stringify({ body: 'text', companionLine: null, choiceLead: null, hp: 99 }) } }] })],
  ] as const)('returns a controlled %s failure for the client fallback', async (reason, fetcher) => {
    vi.stubGlobal('fetch', vi.fn(fetcher));
    const response = await (await server())(input());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: reason });
  });
  it('rejects three invented option IDs before reaching the provider', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const handler = await server();
    const request = buildNarrativeRequest(state(), { kind: 'choice', stage: 'intent' });
    const response = await handler(new Request('https://edge.test', { method: 'POST', body: JSON.stringify({ systemPrompt: 'test', request, optionIds: ['fake-a', 'fake-b', 'fake-c'] }) }));
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('describes confirmed consequences and uses an absent-companion teaching source', async () => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ body: '你已选定守拙。', companionLine: null, choiceLead: null }) } }] }));
    vi.stubGlobal('fetch', fetcher);
    const handler = await server();
    const current = state();
    current.companionState.skipped = true;
    const request = buildNarrativeRequest(current, { kind: 'choice', stage: 'intent' });
    request.confirmedFlags = ['intent-steady'];
    const response = await handler(new Request('https://edge.test', { method: 'POST', body: JSON.stringify({ systemPrompt: 'test', request, optionIds: ['intent-steady', 'intent-swift', 'intent-void'] }) }));
    expect(response.status).toBe(200);
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const upstream = JSON.parse(options[1].body as string);
    expect(upstream.messages[1].content).toContain('只描写已确认选择的后果');
    expect(upstream.messages[1].content).toContain('燕迟不在场');
    expect(upstream.response_format).toEqual({ type: 'json_object' });
    expect(upstream.messages[0].content).toContain('字段必须且只能是 body、companionLine、choiceLead');
    expect(techniqueSourceFor(current, 'returnWind')).not.toContain('燕迟');
  });
  it('forces transport identity and asks the model only for narrative content', async () => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ body: '山风入袖，命盘已定。', companionLine: null, choiceLead: null, eventId: 'fake', requestId: 'fake', canonVersion: 999, source: 'deterministic' }) } }] }));
    vi.stubGlobal('fetch', fetcher);
    const handler = await server();
    const req = input();
    const sent = await req.clone().json();
    const response = await handler(req);
    expect(response.status).toBe(200);
    const content = JSON.parse((await response.json()).content);
    expect(content).toMatchObject({ eventId: sent.request.eventId, requestId: sent.request.requestId, canonVersion: 1, source: 'ai' });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://provider.test/v1/chat/completions');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer stub-key' });
    const upstream = JSON.parse(options.body as string);
    expect(upstream.model).toBe('stub-model');
    expect(upstream.response_format).toEqual({ type: 'json_object' });
    expect(upstream.max_completion_tokens).toBeLessThanOrEqual(800);
  });
  it('reports unavailable for missing configuration without contacting upstream', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await (await server(false))(input());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'unconfigured' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('times out and aborts even when upstream headers arrive but body stalls', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    }));
    const pending = (await server())(input());
    await vi.advanceTimersByTimeAsync(30001);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect(await response.json()).toMatchObject({ error: 'timeout' });
  });
});

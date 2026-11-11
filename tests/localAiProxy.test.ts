import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelTierForEvent, providerConfigured } from '../supabase/functions/_shared/providerRouting';
import { startLocalAiProxy, type LocalAiProxy } from '../server/local-ai-proxy';
import { handleLifeDirectorRequest } from '../supabase/functions/life-director-text/index';
import { LifeEngine } from '@/life/lifeEngine';
import { buildNarrativeRequest } from '@/life/aiNarrative';

let running: LocalAiProxy | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
  vi.unstubAllGlobals();
});

function request(port: number, path: string, method = 'GET', body?: unknown) {
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: payload ? {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    } : undefined }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('trusted provider model routing', () => {
  it('routes ordinary narration to Flash and critical consequences to Pro', () => {
    expect(modelTierForEvent('profile:identity', [])).toBe('flash');
    expect(modelTierForEvent('ch1:technique:diagonalSlash', [])).toBe('flash');
    expect(modelTierForEvent('ch1:choice:intent', [])).toBe('flash');
    expect(modelTierForEvent('ch1:choice:intent', ['intent-steady'])).toBe('pro');
    expect(modelTierForEvent('ch1:choice:fate', ['fate-wander'])).toBe('pro');
    expect(modelTierForEvent('ch1:companion:meet', [])).toBe('pro');
    expect(modelTierForEvent('ch1:archetype', [])).toBe('pro');
  });

  it('requires base URL, key, and both configured routes without exposing values', () => {
    expect(providerConfigured({})).toBe(false);
    expect(providerConfigured({ AI_BASE_URL: 'https://provider.test/v1', AI_API_KEY: 'secret', AI_MODEL_FLASH: 'flash', AI_MODEL_PRO: 'pro' })).toBe(true);
  });

  it('applies Flash/Pro routing inside the provider request', async () => {
    const upstream = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ choices: [{ message: { content: JSON.stringify({
      body: '山风入袖，命盘已定。', companionLine: null, choiceLead: null,
    }) } }] }));
    vi.stubGlobal('fetch', upstream);
    const env = {
      AI_BASE_URL: 'https://provider.test/v1', AI_API_KEY: 'server-secret',
      AI_MODEL_FLASH: 'deepseek-v4-flash', AI_MODEL_PRO: 'deepseek-v4-pro',
    };
    const engine = new LifeEngine();
    engine.loadSeed(1234); engine.selectGender('male', 1); engine.generateIdentity(2);
    const ordinary = buildNarrativeRequest(engine.getState(), { kind: 'identity' });
    const invoke = (request: typeof ordinary, optionIds: string[] = []) => handleLifeDirectorRequest(new Request('http://proxy.test/api/life-director-text', {
      method: 'POST', body: JSON.stringify({ systemPrompt: '固定世界叙事', request, optionIds }),
    }), key => env[key as keyof typeof env]);
    expect((await invoke(ordinary)).status).toBe(200);
    const critical = structuredClone(ordinary);
    critical.eventId = 'ch1:choice:intent';
    critical.requestId = 'req:critical';
    critical.identity = {
      lifeId: 'life:test', chapterInstanceId: 'chapter:test', eventDefinitionId: critical.eventId,
      eventInstanceId: 'event:test', requestId: critical.requestId,
    };
    critical.confirmedFlags = ['intent-steady'];
    expect((await invoke(critical, ['intent-steady', 'intent-swift', 'intent-void'])).status).toBe(200);
    const bodies = upstream.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies.map(body => body.model)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
    expect(JSON.stringify(bodies)).not.toContain('server-secret');
  });
});

describe('local AI proxy', () => {
  it('serves a secret-free health response when AI is not configured', async () => {
    running = await startLocalAiProxy({ host: '127.0.0.1', port: 0, env: {} });
    const response = await request(running.port, '/health');
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ status: 'ok', service: 'jianwen-life-director', aiConfigured: false });
    expect(JSON.stringify(response.json)).not.toMatch(/key|secret|model/i);
  });

  it('keeps the proxy alive and returns controlled unconfigured for narrative POST', async () => {
    running = await startLocalAiProxy({ host: '127.0.0.1', port: 0, env: {} });
    const response = await request(running.port, '/api/life-director-text', 'POST', {});
    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: 'Invalid request body' });
    expect((await request(running.port, '/health')).json.aiConfigured).toBe(false);
  });
});

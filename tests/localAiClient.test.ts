// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LifeEngine } from '@/life/lifeEngine';

vi.mock('@/db/supabase', () => ({ supabase: null }));

describe('browser local AI proxy transport', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const narrative = await import('@/life/aiNarrative');
    narrative.clearNarrativeCache();
    narrative.clearNarrativeStore();
    localStorage.clear();
  });

  it('uses same-origin proxy and never sends provider credentials', async () => {
    const engine = new LifeEngine();
    engine.loadSeed(1234);
    engine.selectGender('male', 1);
    engine.generateIdentity(2);
    const identity = engine.eventIdentity()!;
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ content: JSON.stringify({
      eventId: 'profile:identity', requestId: identity.requestId, canonVersion: 1, source: 'ai',
      body: '山风入袖，命盘已定。', companionLine: null, choiceLead: null,
    }) }));
    vi.stubGlobal('fetch', fetcher);
    const { requestNarrative } = await import('@/life/aiNarrative');
    const result = await requestNarrative(engine.getState(), { kind: 'identity' });
    expect(result.source).toBe('ai');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/life-director-text');
    expect(JSON.stringify(init)).not.toMatch(/authorization|api[_-]?key|bearer/i);
  });
});

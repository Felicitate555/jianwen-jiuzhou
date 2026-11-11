/** Trusted, server-side model routing. The browser never selects a provider model. */
export type ProviderModelTier = 'flash' | 'pro';

export type ProviderEnvironment = Record<string, string | undefined>;

const INTENT_OPTIONS = new Set(['intent-steady', 'intent-swift', 'intent-void']);
const FATE_OPTIONS = new Set(['fate-sect', 'fate-wander', 'fate-companion']);

export function modelTierForEvent(eventId: string, confirmedFlags: readonly string[]): ProviderModelTier {
  if (eventId === 'ch1:archetype' || eventId === 'ch1:companion:meet') return 'pro';
  if (eventId === 'ch1:choice:intent' && confirmedFlags.some(flag => INTENT_OPTIONS.has(flag))) return 'pro';
  if (eventId === 'ch1:choice:fate' && confirmedFlags.some(flag => FATE_OPTIONS.has(flag))) return 'pro';
  return 'flash';
}

export function providerModelForEvent(
  eventId: string,
  confirmedFlags: readonly string[],
  env: ProviderEnvironment,
): string | null {
  const tier = modelTierForEvent(eventId, confirmedFlags);
  // AI_MODEL remains a migration fallback for an already deployed Edge Function.
  return (tier === 'pro' ? env.AI_MODEL_PRO : env.AI_MODEL_FLASH)?.trim()
    || env.AI_MODEL?.trim()
    || null;
}

export function providerConfigured(env: ProviderEnvironment): boolean {
  const baseUrl = env.AI_BASE_URL?.trim();
  return Boolean(
    baseUrl && /^https?:\/\//.test(baseUrl)
    && env.AI_API_KEY?.trim()
    && env.AI_MODEL_FLASH?.trim()
    && env.AI_MODEL_PRO?.trim(),
  );
}

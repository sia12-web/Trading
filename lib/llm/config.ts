/**
 * LLM routing — live vs simulation tiers.
 *
 * Level Finder (live desk) always uses the best Opus — never cut quality there.
 * Feed/SSE savings are separate; sim replay uses cheap Haiku.
 * Optional Gemini Flash verifier when GEMINI_API_KEY is set.
 */

export type LlmProvider = 'anthropic' | 'gemini'

export type LlmRole = 'proposer' | 'verifier'

/** Live = real trading desk; sim = replay / practice (cheap model). */
export type LlmTier = 'live' | 'sim'

/** Best available Opus for live Level Finder (do not downgrade for cost). */
export const DEFAULT_LEVEL_FINDER_MODEL = 'claude-opus-4-8'
const DEFAULT_SIM_PROPOSER_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_VERIFIER_MODEL = 'gemini-2.0-flash'

export function parseLlmTier(raw: unknown): LlmTier {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (
    s === 'sim' ||
    s === 'simulation' ||
    s === 'replay' ||
    s === 'cheap' ||
    s === 'practice'
  ) {
    return 'sim'
  }
  return 'live'
}

function providerFromEnv(raw: string | undefined, fallback: LlmProvider): LlmProvider {
  const v = (raw || fallback).toLowerCase()
  if (v === 'gemini' || v === 'google') return 'gemini'
  if (v === 'off' || v === 'false' || v === '0' || v === 'none') return fallback
  return 'anthropic'
}

export function llmProvider(role: LlmRole, tier: LlmTier = 'live'): LlmProvider {
  if (role === 'verifier') {
    return providerFromEnv(process.env.LLM_VERIFIER, 'gemini')
  }
  if (tier === 'sim') {
    // Sim can use Gemini Flash if explicitly set; otherwise Anthropic Haiku
    return providerFromEnv(
      process.env.LLM_SIM_PROPOSER || process.env.LLM_PROPOSER,
      'anthropic'
    )
  }
  return providerFromEnv(process.env.LLM_PROPOSER, 'anthropic')
}

export function llmModel(role: LlmRole, tier: LlmTier = 'live'): string {
  if (role === 'verifier') {
    return (process.env.LLM_VERIFIER_MODEL || DEFAULT_VERIFIER_MODEL).trim()
  }
  if (tier === 'sim') {
    return (
      process.env.LLM_SIM_PROPOSER_MODEL ||
      process.env.LLM_SIM_MODEL ||
      DEFAULT_SIM_PROPOSER_MODEL
    ).trim()
  }
  return llmLevelFinderModel()
}

/**
 * Live Level Finder model — always the quality tier.
 * Prefer LLM_LEVEL_FINDER_MODEL, then LLM_PROPOSER_MODEL, then latest Opus.
 * Never falls back to sim/Haiku.
 */
export function llmLevelFinderModel(): string {
  return (
    process.env.LLM_LEVEL_FINDER_MODEL ||
    process.env.LLM_PROPOSER_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    DEFAULT_LEVEL_FINDER_MODEL
  ).trim()
}

export function isProviderConfigured(provider: LlmProvider): boolean {
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
  return Boolean(process.env.GEMINI_API_KEY?.trim())
}

/** Verifier is optional — off when no Gemini key or LLM_VERIFIER=off */
export function isVerifierEnabled(): boolean {
  const flag = (process.env.LLM_VERIFIER || 'gemini').toLowerCase()
  if (flag === 'off' || flag === 'false' || flag === '0' || flag === 'none') return false
  return isProviderConfigured(llmProvider('verifier'))
}

export function llmConfigSnapshot() {
  const liveProvider = llmProvider('proposer', 'live')
  const simProvider = llmProvider('proposer', 'sim')
  return {
    proposer: {
      provider: liveProvider,
      model: llmLevelFinderModel(),
      configured: isProviderConfigured(liveProvider),
      tier: 'live' as const,
      role: 'level_finder',
    },
    sim_proposer: {
      provider: simProvider,
      model: llmModel('proposer', 'sim'),
      configured: isProviderConfigured(simProvider),
      tier: 'sim' as const,
    },
    verifier: {
      enabled: isVerifierEnabled(),
      provider: llmProvider('verifier'),
      model: llmModel('verifier'),
      configured: isProviderConfigured(llmProvider('verifier')),
    },
  }
}

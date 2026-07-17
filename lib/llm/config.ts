/**
 * LLM routing — simple proposer (+ optional verifier). No multi-agent debate.
 *
 * Defaults favor quality for levels (Claude Opus) with a cheap Gemini Flash
 * verifier when GEMINI_API_KEY is set. Deterministic grounding is always on.
 */

export type LlmProvider = 'anthropic' | 'gemini'

export type LlmRole = 'proposer' | 'verifier'

const DEFAULT_PROPOSER_MODEL = 'claude-opus-4-20250514'
const DEFAULT_VERIFIER_MODEL = 'gemini-2.0-flash'

export function llmProvider(role: LlmRole): LlmProvider {
  const key = role === 'proposer' ? 'LLM_PROPOSER' : 'LLM_VERIFIER'
  const raw = (process.env[key] || (role === 'proposer' ? 'anthropic' : 'gemini')).toLowerCase()
  if (raw === 'gemini' || raw === 'google') return 'gemini'
  return 'anthropic'
}

export function llmModel(role: LlmRole): string {
  if (role === 'proposer') {
    return (
      process.env.LLM_PROPOSER_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      DEFAULT_PROPOSER_MODEL
    ).trim()
  }
  return (process.env.LLM_VERIFIER_MODEL || DEFAULT_VERIFIER_MODEL).trim()
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
  return {
    proposer: {
      provider: llmProvider('proposer'),
      model: llmModel('proposer'),
      configured: isProviderConfigured(llmProvider('proposer')),
    },
    verifier: {
      enabled: isVerifierEnabled(),
      provider: llmProvider('verifier'),
      model: llmModel('verifier'),
      configured: isProviderConfigured(llmProvider('verifier')),
    },
  }
}

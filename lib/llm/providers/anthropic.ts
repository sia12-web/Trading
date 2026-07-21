import Anthropic from '@anthropic-ai/sdk'
import type { LlmCompleteRequest, LlmCompleteResult } from '@/lib/llm/types'

/**
 * Opus 4.6+ / Fable reject temperature / top_p / top_k (400).
 * Older dated Opus IDs still accept temperature.
 */
function supportsTemperature(model: string): boolean {
  const m = model.toLowerCase()
  if (m.includes('fable')) return false
  if (/claude-opus-4-[6-9]/.test(m)) return false
  if (/claude-opus-4-\d+$/.test(m) && !m.includes('2025')) return false
  if (/claude-sonnet-5/.test(m)) return false
  return true
}

function normalizeAnthropicModel(model: string): string {
  const m = model.trim().toLowerCase()
  if (m === 'claude-3-5-sonnet-20241022' || m === 'claude-3-5-sonnet-latest' || m === 'claude-3-opus-20240229' || m === 'claude-3-5-haiku-20241022') {
    return m
  }
  if (m.includes('sonnet')) {
    return 'claude-3-5-sonnet-20241022'
  }
  if (m.includes('opus')) {
    return 'claude-3-opus-20240229'
  }
  if (m.includes('haiku')) {
    return 'claude-3-5-haiku-20241022'
  }
  return model
}

export async function completeAnthropic(
  req: LlmCompleteRequest,
  signal?: AbortSignal
): Promise<LlmCompleteResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const client = new Anthropic({ apiKey })
  const apiModel = normalizeAnthropicModel(req.model)
  const body: Anthropic.MessageCreateParams = {
    model: apiModel,
    max_tokens: req.maxTokens ?? 1024,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  }
  if (supportsTemperature(req.model) && req.temperature != null) {
    body.temperature = req.temperature
  } else if (supportsTemperature(req.model)) {
    body.temperature = 0.2
  }

  const response = await client.messages.create(
    body,
    signal ? { signal: signal as AbortSignal } : undefined
  )

  const block = response.content[0]
  if (!block || block.type !== 'text') {
    throw new Error('Unexpected Anthropic response format')
  }

  return {
    text: block.text,
    usage: {
      provider: 'anthropic',
      model: req.model,
      role: 'proposer',
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  }
}

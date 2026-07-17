import Anthropic from '@anthropic-ai/sdk'
import type { LlmCompleteRequest, LlmCompleteResult } from '@/lib/llm/types'

export async function completeAnthropic(
  req: LlmCompleteRequest,
  signal?: AbortSignal
): Promise<LlmCompleteResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create(
    {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    },
    signal ? { signal: signal as any } : undefined
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

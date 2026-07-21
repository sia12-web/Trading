import type { LlmCompleteRequest, LlmCompleteResult } from '@/lib/llm/types'

export async function completeOpenAI(
  req: LlmCompleteRequest,
  signal?: AbortSignal
): Promise<LlmCompleteResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const model = req.model && req.model.startsWith('gpt-') ? req.model : 'gpt-4o-mini'

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.user },
      ],
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.3,
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`OpenAI API error (${response.status}): ${errText}`)
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
    usage?: { prompt_tokens: number; completion_tokens: number }
  }

  const text = json.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('Empty response from OpenAI API')

  return {
    text,
    usage: {
      provider: 'openai' as any,
      model,
      role: 'proposer',
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    },
  }
}

import { completeAnthropic } from '@/lib/llm/providers/anthropic'
import { completeGemini } from '@/lib/llm/providers/gemini'
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '@/lib/llm/types'

export async function llmComplete(
  req: LlmCompleteRequest,
  signal?: AbortSignal
): Promise<LlmCompleteResult> {
  if (req.provider === 'gemini') {
    const result = await completeGemini(req, signal)
    return result
  }
  const result = await completeAnthropic(req, signal)
  return result
}

export function providerLabel(p: LlmProvider): string {
  return p === 'gemini' ? 'Gemini' : 'Claude'
}

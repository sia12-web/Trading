import { completeAnthropic } from '@/lib/llm/providers/anthropic'
import { completeGemini } from '@/lib/llm/providers/gemini'
import { completeOpenAI } from '@/lib/llm/providers/openai'
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from '@/lib/llm/types'
import { logger } from '@/lib/utils/logger'

export async function llmComplete(
  req: LlmCompleteRequest,
  signal?: AbortSignal
): Promise<LlmCompleteResult> {
  if (req.provider === 'openai') {
    return await completeOpenAI(req, signal)
  }

  if (req.provider === 'gemini') {
    try {
      return await completeGemini(req, signal)
    } catch (err) {
      if (process.env.OPENAI_API_KEY) {
        logger.warn('llm.gemini_fallback_to_openai', { err })
        return await completeOpenAI({ ...req, provider: 'openai', model: 'gpt-4o-mini' }, signal)
      }
      throw err
    }
  }

  try {
    return await completeAnthropic(req, signal)
  } catch (err) {
    if (process.env.OPENAI_API_KEY) {
      logger.warn('llm.anthropic_fallback_to_openai', { err })
      return await completeOpenAI({ ...req, provider: 'openai', model: 'gpt-4o-mini' }, signal)
    }
    throw err
  }
}

export function providerLabel(p: LlmProvider): string {
  if (p === 'openai') return 'OpenAI'
  return p === 'gemini' ? 'Gemini' : 'Claude'
}

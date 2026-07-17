/**
 * Optional cheap verifier (Gemini Flash by default).
 * Does NOT invent levels — only KEEP/DROP indices already grounded in code.
 */

import { isVerifierEnabled, llmModel, llmProvider } from '@/lib/llm/config'
import { llmComplete } from '@/lib/llm/complete'
import { logger } from '@/lib/utils/logger'
import type { LevelIdentification } from '@/lib/services/levelFinderAgent/types'
import type { LlmUsage } from '@/lib/llm/types'

export async function verifyLevelsKeepDrop(
  levels: LevelIdentification[],
  context: { instrument: string; currentPrice: number }
): Promise<{ kept: LevelIdentification[]; usage: LlmUsage | null }> {
  if (!isVerifierEnabled() || levels.length === 0) {
    return { kept: levels, usage: null }
  }

  const provider = llmProvider('verifier')
  const model = llmModel('verifier')

  const system = `You are a STRICT trading-level auditor. You do NOT invent prices or levels.
You only decide KEEP or DROP for each numbered candidate.
DROP if reasoning is generic, contradicts the price, or invents volume/events not plausible.
KEEP if reasoning is specific and consistent with that price being a stop-liquidity / structure level.
Return ONLY JSON: {"keep":[0,2]} with zero-based indices.`

  const user = `Instrument: ${context.instrument}
Current price: ${context.currentPrice}
Candidates:
${levels
  .map(
    (l, i) =>
      `${i}. level=${l.level} type=${l.type} conviction=${l.conviction} tf=${l.timeframe} reasoning=${JSON.stringify(l.reasoning)}`
  )
  .join('\n')}
`

  try {
    const result = await llmComplete({
      provider,
      model,
      system,
      user,
      maxTokens: 256,
      temperature: 0,
    })

    result.usage.role = 'verifier'

    let keepIdx: number[] = []
    try {
      const parsed = JSON.parse(result.text)
      if (Array.isArray(parsed?.keep)) {
        keepIdx = parsed.keep.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n))
      }
    } catch {
      const m = result.text.match(/\{[\s\S]*\}/)
      if (m) {
        const parsed = JSON.parse(m[0])
        if (Array.isArray(parsed?.keep)) {
          keepIdx = parsed.keep.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n))
        }
      }
    }

    const uniq = [...new Set(keepIdx)].filter((i) => i >= 0 && i < levels.length)
    // If verifier returns empty, keep all grounded (fail-open on empty keep to avoid wiping desk)
    const kept = uniq.length === 0 ? levels : uniq.map((i) => levels[i]!)

    logger.info('llm.verifier', {
      provider,
      model,
      proposed: levels.length,
      kept: kept.length,
      keepIdx: uniq,
    })

    return { kept, usage: result.usage }
  } catch (err) {
    logger.warn('llm.verifier_failed_fail_open', { err })
    return { kept: levels, usage: null }
  }
}

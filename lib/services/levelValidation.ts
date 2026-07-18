/**
 * Market-verdict engine for AI levels.
 * Replays real candles over stored levels and records how the market actually
 * treated each one (held / broke), so the AI's memory reflects price action —
 * not opinions.
 *
 * Runs: pre-analysis, mid-morning cadence (~2m from live chart), trade exit,
 * lunch morning-review, and EOD journal. Never calls an LLM.
 */

import { getOandaCandles } from '@/lib/oanda/candles'
import { getYahooCandles } from '@/lib/yahoo/candles'
import { LEVEL_ZONE_PCT } from '@/lib/trading/deskLevels'
import type { Instrument } from '@/types/price-feed'

export interface MarketBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface LevelVerdict {
  id: string
  level: number
  type: string
  /** Distinct test episodes (consecutive touching bars = one test) */
  tests: number
  holds: number
  breaks: number
  lastOutcome: 'held' | 'broke' | 'untested'
  lastTestedAt: number | null
  verdict: 'respected' | 'contested' | 'broken' | 'untested'
}

/**
 * Judge one level against candles.
 * A "test" starts when a bar's range touches the level and ends when price
 * clears the level by `clearancePct` on either side. The approach side decides
 * what counts as a hold: if price came from above and cleared back above, the
 * level held as support; clearing below means the market broke it.
 * Clearance = the level's ZONE half-width, so memory grades levels exactly
 * the way the desks trade them (a sweep inside the zone is NOT a break).
 */
export function evaluateLevel(
  level: number,
  bars: MarketBar[],
  clearancePct = LEVEL_ZONE_PCT
): Omit<LevelVerdict, 'id' | 'type' | 'level'> {
  const clearance = level * clearancePct
  let tests = 0
  let holds = 0
  let breaks = 0
  let lastOutcome: 'held' | 'broke' | 'untested' = 'untested'
  let lastTestedAt: number | null = null

  let prevClose: number | null = null
  let i = 0
  while (i < bars.length) {
    const b = bars[i]!
    if (b.low <= level && b.high >= level) {
      const ref = prevClose ?? b.open
      const approachedFromAbove = ref >= level

      // Consume the episode until price clears the level decisively
      let j = i
      let outcome: 'held' | 'broke' | null = null
      while (j < bars.length) {
        const c = bars[j]!
        if (c.close >= level + clearance) {
          outcome = approachedFromAbove ? 'held' : 'broke'
          break
        }
        if (c.close <= level - clearance) {
          outcome = approachedFromAbove ? 'broke' : 'held'
          break
        }
        j++
      }

      tests++
      lastTestedAt = b.time
      if (outcome === 'held') {
        holds++
        lastOutcome = 'held'
      } else if (outcome === 'broke') {
        breaks++
        lastOutcome = 'broke'
      }
      // outcome === null → still pinned at the level when data ends; unresolved

      const endIdx = Math.min(j, bars.length - 1)
      prevClose = bars[endIdx]!.close
      i = j + 1
    } else {
      prevClose = b.close
      i++
    }
  }

  let verdict: LevelVerdict['verdict'] = 'untested'
  if (tests > 0) {
    if (lastOutcome === 'broke') verdict = 'broken'
    else if (breaks === 0 && holds > 0) verdict = 'respected'
    else verdict = 'contested'
  }

  return { tests, holds, breaks, lastOutcome, lastTestedAt, verdict }
}

/**
 * Fetch real candles, judge every stored level for this user+instrument, and
 * write the market's verdict back to level_history (tested_count = real tests,
 * success_count = real holds). Returns the verdicts for prompt/UI use.
 */
export async function validateLevelsAgainstMarket(
  supabase: any,
  userId: string,
  instrument: Instrument,
  days = 7
): Promise<{ validated: number; updated: number; verdicts: LevelVerdict[] }> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const { data: levels, error: fetchError } = await supabase
    .from('level_history')
    .select('id, level, type, created_at')
    .eq('user_id', userId)
    .eq('instrument', instrument)
    .gte('created_at', cutoff.toISOString())

  if (fetchError || !levels || levels.length === 0) {
    return { validated: 0, updated: 0, verdicts: [] }
  }

  const feed =
    (await getOandaCandles(instrument, '5', days)) ??
    (await getYahooCandles(instrument, '5', days))
  const bars: MarketBar[] = feed?.candles ?? []
  if (bars.length === 0) {
    return { validated: levels.length, updated: 0, verdicts: [] }
  }

  const verdicts: LevelVerdict[] = []
  let updated = 0

  for (const row of levels) {
    // Only judge the level from the moment the AI called it
    const createdUnix = Math.floor(new Date(row.created_at).getTime() / 1000)
    const scope = bars.filter((b) => b.time >= createdUnix)
    const result = evaluateLevel(row.level, scope.length > 0 ? scope : bars)

    verdicts.push({
      id: row.id,
      level: row.level,
      type: row.type,
      ...result,
    })

    const patch: Record<string, unknown> = {
      last_verdict: result.verdict,
      last_outcome: result.lastOutcome,
    }
    if (result.tests > 0) {
      patch.tested_count = result.tests
      patch.success_count = result.holds
      patch.last_tested_date = result.lastTestedAt
        ? new Date(result.lastTestedAt * 1000).toISOString()
        : null
    }

    const { error: updateError } = await supabase
      .from('level_history')
      .update(patch)
      .eq('id', row.id)

    if (!updateError) updated++
    else console.warn('[Level Validation] Update failed for', row.id, updateError.message)
  }

  return { validated: levels.length, updated, verdicts }
}

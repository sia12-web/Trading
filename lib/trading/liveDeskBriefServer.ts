/**
 * Server-side Live Desk Brief — loads OANDA playbook ranges + optional
 * overnight regime for DOW / NASDAQ.
 */

import { createClient } from '@/lib/supabase/server'
import {
  buildLiveDeskBrief,
  type InstrumentBriefFacts,
  type LiveDeskBrief,
} from '@/lib/trading/liveDeskBrief'
import { resolveServerPlaybookBundle } from '@/lib/trading/serverPlaybookRange'
import type { DeskInstrument, DeskMarket } from '@/lib/trading/sessionGate'
import { getESTDateString } from '@/lib/utils/timeUtils'
import { logger } from '@/lib/utils/logger'

const ALL: DeskInstrument[] = ['DOW', 'NASDAQ']

async function overnightNoteFor(
  instrument: DeskInstrument
): Promise<string | null> {
  try {
    const supabase = await createClient()
    const date = getESTDateString()
    const { data } = await supabase
      .from('regime_cache')
      .select('regime, regime_confidence, gap_percent')
      .eq('instrument', instrument)
      .eq('date', date)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!data) return null
    const regime = (data as { regime?: string }).regime
    const conf = (data as { regime_confidence?: number }).regime_confidence
    const gap = (data as { gap_percent?: number }).gap_percent
    const parts = [
      regime ? String(regime) : null,
      conf != null ? `${conf}%` : null,
      gap != null ? `gap ${gap}%` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : null
  } catch (err) {
    logger.warn('live_desk_brief.overnight_failed', { err, instrument })
    return null
  }
}

async function factsForInstrument(
  instrument: DeskInstrument,
  now: Date
): Promise<InstrumentBriefFacts> {
  const bundle = await resolveServerPlaybookBundle({ instrument, now })
  const overnightNote = await overnightNoteFor(instrument)

  if (!bundle) {
    return { instrument, overnightNote }
  }

  const { shaped, ladder } = bundle
  return {
    instrument,
    ladder,
    overnightNote,
    or30: shaped.or30
      ? { high: shaped.or30.high, low: shaped.or30.low, complete: true }
      : null,
    ib: shaped.ib
      ? { high: shaped.ib.high, low: shaped.ib.low, complete: true }
      : null,
    usRange: shaped.usRange
      ? { high: shaped.usRange.high, low: shaped.usRange.low, complete: true }
      : null,
    lunchRange: shaped.lunchRange
      ? {
          high: shaped.lunchRange.high,
          low: shaped.lunchRange.low,
          complete: true,
        }
      : null,
  }
}

/** Build ranked live desk brief for NY names. */
export async function loadLiveDeskBrief(args?: {
  now?: Date
  focusMarket?: DeskMarket | 'ALL'
}): Promise<LiveDeskBrief> {
  const now = args?.now ?? new Date()
  const focusMarket = args?.focusMarket ?? 'ALL'
  const facts = await Promise.all(ALL.map((inst) => factsForInstrument(inst, now)))
  return buildLiveDeskBrief(facts, now, focusMarket)
}

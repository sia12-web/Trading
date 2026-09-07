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
  _now: Date
): Promise<InstrumentBriefFacts> {
  const overnightNote = await overnightNoteFor(instrument)
  return { instrument, overnightNote }
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

/**
 * Live Voice session persistence — turns + user-spoken level pins.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { deskMarketFor, type DeskInstrument, type DeskMarket } from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'

export type LiveVoicePin = {
  id?: string
  price: number
  side: 'BUY' | 'SHORT' | null
  reason: string | null
  source: 'user_voice'
}

export type LiveVoiceSessionRow = {
  id: string
  user_id: string
  instrument: DeskInstrument
  market: DeskMarket
  trade_date: string
  status: 'active' | 'closed'
}

/** Parse prices the trader spoke; snap to nearby AI levels when within 0.25%. */
export function extractPinsFromTranscript(
  transcript: string,
  aiPrices: Array<{ price: number; side?: 'BUY' | 'SHORT' | null }>
): LiveVoicePin[] {
  const text = transcript.trim()
  if (!text) return []

  const lower = text.toLowerCase()
  const globalSide: 'BUY' | 'SHORT' | null = /\b(short|sell|resistance)\b/.test(lower)
    ? 'SHORT'
    : /\b(long|buy|support|bid)\b/.test(lower)
      ? 'BUY'
      : null

  const rawMatches = text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{3,7}(?:\.\d+)?\b/g) || []
  const pins: LiveVoicePin[] = []
  const seen = new Set<number>()

  for (const raw of rawMatches) {
    const price = Number(String(raw).replace(/,/g, ''))
    if (!Number.isFinite(price) || price < 100) continue

    let pinned = price
    let side = globalSide
    let reason: string | null = `Spoken level ${price.toLocaleString()}`

    let bestDist = Infinity
    for (const ai of aiPrices) {
      if (!(ai.price > 0)) continue
      const d = Math.abs(ai.price - price) / ai.price
      if (d <= 0.0025 && d < bestDist) {
        bestDist = d
        pinned = ai.price
        side = ai.side ?? side
        reason = `Aligned with AI level ${ai.price.toLocaleString()}`
      }
    }

    const key = Math.round(pinned * 100) / 100
    if (seen.has(key)) continue
    seen.add(key)
    pins.push({
      price: pinned,
      side,
      reason,
      source: 'user_voice',
    })
  }

  return pins.slice(0, 6)
}

export async function getOrCreateLiveVoiceSession(
  supabase: SupabaseClient,
  args: {
    userId: string
    instrument: DeskInstrument
    tradeDate: string
  }
): Promise<LiveVoiceSessionRow | null> {
  const market = deskMarketFor(args.instrument)

  const { data: existing } = await supabase
    .from('live_voice_sessions')
    .select('id, user_id, instrument, market, trade_date, status')
    .eq('user_id', args.userId)
    .eq('instrument', args.instrument)
    .eq('trade_date', args.tradeDate)
    .maybeSingle()

  if (existing?.id) {
    if (existing.status === 'closed') {
      const { data: reopened, error: reopenErr } = await supabase
        .from('live_voice_sessions')
        .update({ status: 'active', ended_at: null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('id, user_id, instrument, market, trade_date, status')
        .single()
      if (reopenErr || !reopened) {
        logger.warn('live_voice.session_reopen_failed', { error: reopenErr?.message })
        return null
      }
      return reopened as LiveVoiceSessionRow
    }
    return existing as LiveVoiceSessionRow
  }

  const { data: created, error } = await supabase
    .from('live_voice_sessions')
    .insert({
      user_id: args.userId,
      instrument: args.instrument,
      market,
      trade_date: args.tradeDate,
      status: 'active',
    })
    .select('id, user_id, instrument, market, trade_date, status')
    .single()

  if (error || !created) {
    logger.warn('live_voice.session_create_failed', { error: error?.message })
    return null
  }
  return created as LiveVoiceSessionRow
}

export async function loadLiveVoicePins(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<LiveVoicePin[]> {
  const { data, error } = await supabase
    .from('live_voice_pins')
    .select('id, price, side, reason, source')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    logger.warn('live_voice.pins_load_failed', { error: error.message })
    return []
  }

  return (data || []).map((p) => ({
    id: p.id as string,
    price: Number(p.price),
    side: p.side === 'BUY' || p.side === 'SHORT' ? p.side : null,
    reason: typeof p.reason === 'string' ? p.reason : null,
    source: 'user_voice' as const,
  }))
}

export async function persistLiveVoiceTurn(args: {
  supabase: SupabaseClient
  userId: string
  instrument: DeskInstrument
  tradeDate: string
  transcript: string
  replyText: string
  aiLevels: Array<{ price: number; side?: 'BUY' | 'SHORT' | null }>
}): Promise<{ sessionId: string | null; pins: LiveVoicePin[]; newPins: LiveVoicePin[] }> {
  const session = await getOrCreateLiveVoiceSession(args.supabase, {
    userId: args.userId,
    instrument: args.instrument,
    tradeDate: args.tradeDate,
  })

  if (!session) {
    return { sessionId: null, pins: [], newPins: [] }
  }

  const turnRows = [
    { session_id: session.id, user_id: args.userId, role: 'user', text: args.transcript },
    { session_id: session.id, user_id: args.userId, role: 'assistant', text: args.replyText },
  ]
  const { error: turnErr } = await args.supabase.from('live_voice_turns').insert(turnRows)
  if (turnErr) {
    logger.warn('live_voice.turns_insert_failed', { error: turnErr.message })
  }

  const extracted = extractPinsFromTranscript(args.transcript, args.aiLevels)
  const newPins: LiveVoicePin[] = []
  for (const pin of extracted) {
    const { data, error } = await args.supabase
      .from('live_voice_pins')
      .upsert(
        {
          session_id: session.id,
          user_id: args.userId,
          price: pin.price,
          side: pin.side,
          reason: pin.reason,
          source: 'user_voice',
        },
        { onConflict: 'session_id,price' }
      )
      .select('id, price, side, reason, source')
      .maybeSingle()

    if (error) {
      logger.warn('live_voice.pin_upsert_failed', { error: error.message })
      continue
    }
    if (data) {
      newPins.push({
        id: data.id as string,
        price: Number(data.price),
        side: data.side === 'BUY' || data.side === 'SHORT' ? data.side : null,
        reason: typeof data.reason === 'string' ? data.reason : null,
        source: 'user_voice',
      })
    }
  }

  const pins = await loadLiveVoicePins(args.supabase, session.id, args.userId)
  await args.supabase
    .from('live_voice_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', session.id)

  return { sessionId: session.id, pins, newPins }
}

export async function listLiveVoiceTranscripts(
  supabase: SupabaseClient,
  userId: string,
  opts: { days?: number; instrument?: DeskInstrument | null; limit?: number }
) {
  const days = Math.min(Math.max(opts.days ?? 14, 1), 90)
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  let q = supabase
    .from('live_voice_sessions')
    .select('id, instrument, market, trade_date, status, started_at, ended_at, updated_at')
    .eq('user_id', userId)
    .gte('trade_date', cutoffStr)
    .order('trade_date', { ascending: false })
    .limit(limit)

  if (opts.instrument) {
    q = q.eq('instrument', opts.instrument)
  }

  const { data: sessions, error } = await q
  if (error) {
    logger.warn('live_voice.sessions_list_failed', { error: error.message })
    return []
  }

  const out = []
  for (const s of sessions || []) {
    const [{ data: turns }, { data: pins }] = await Promise.all([
      supabase
        .from('live_voice_turns')
        .select('role, text, created_at')
        .eq('session_id', s.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(80),
      supabase
        .from('live_voice_pins')
        .select('price, side, reason, created_at')
        .eq('session_id', s.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    ])

    out.push({
      id: s.id as string,
      instrument: s.instrument as DeskInstrument,
      market: s.market as DeskMarket,
      trade_date: s.trade_date as string,
      status: s.status as string,
      started_at: s.started_at as string,
      updated_at: s.updated_at as string,
      turns: (turns || []).map((t) => ({
        role: t.role as 'user' | 'assistant' | 'system',
        text: t.text as string,
        created_at: t.created_at as string,
      })),
      pins: (pins || []).map((p) => ({
        price: Number(p.price),
        side: p.side === 'BUY' || p.side === 'SHORT' ? p.side : null,
        reason: typeof p.reason === 'string' ? p.reason : null,
      })),
    })
  }

  return out
}

/**
 * Live Voice Slice 5 — level-tag reactions (server).
 * Pure helpers live in liveVoiceReactionCore.ts (client-safe).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { synthesizeSpeechMp3 } from '@/lib/speech/openaiSpeech'
import { liveVoiceDevBypassEnabled } from '@/lib/trading/liveVoice'
import { buildLiveVoiceDeskContext } from '@/lib/trading/liveVoiceContext'
import {
  getOrCreateLiveVoiceSession,
  loadLiveVoicePins,
} from '@/lib/trading/liveVoiceSession'
import { assertReactVerdictMatchesTip } from '@/lib/trading/liveVoiceGuards'
import {
  LIVE_VOICE_MAX_REACTIONS_PER_LEVEL,
  buildLevelTagReactionText,
  type LevelTagEvent,
  type LevelTagVerdict,
} from '@/lib/trading/liveVoiceReactionCore'
import type { DeskInstrument } from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'

export {
  LIVE_VOICE_MAX_REACTIONS_PER_LEVEL,
  LIVE_VOICE_TAG_PCT,
  tagDistance,
  isTipTaggingLevel,
  classifyLevelReaction,
  buildLevelTagReactionText,
  dedupeWatchLevels,
  type LevelTagVerdict,
  type LevelTagEvent,
} from '@/lib/trading/liveVoiceReactionCore'

async function countReactionsForPrice(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  price: number
): Promise<number> {
  const token = `level_tag:${Math.round(price * 100) / 100}`
  const { data, error } = await supabase
    .from('live_voice_turns')
    .select('id, text')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('role', 'system')
    .ilike('text', `${token}%`)

  if (error) {
    logger.warn('live_voice.reaction_count_failed', { error: error.message })
    return LIVE_VOICE_MAX_REACTIONS_PER_LEVEL // fail closed
  }
  return (data || []).length
}

export type LiveVoiceReactResult = {
  reacted: boolean
  skippedReason: string | null
  replyText: string | null
  audioBase64: string | null
  audioMime: string | null
  verdict: LevelTagVerdict | null
  price: number | null
  sessionId: string | null
}

export async function runLiveVoiceLevelReaction(args: {
  supabase: SupabaseClient
  userId: string
  instrument: DeskInstrument
  event: LevelTagEvent
}): Promise<LiveVoiceReactResult> {
  const ctx = await buildLiveVoiceDeskContext(
    args.supabase,
    args.userId,
    args.instrument
  )

  if (!ctx.voice.clockedIn) {
    return {
      reacted: false,
      skippedReason: 'Clock in required',
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: null,
      price: null,
      sessionId: null,
    }
  }
  if (!ctx.voice.enabled || !ctx.voice.inVoiceWindow) {
    return {
      reacted: false,
      skippedReason: ctx.voice.reason || 'Outside Live Voice window',
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: null,
      price: null,
      sessionId: null,
    }
  }

  // Only react once cash is open (ENTRY / MANAGE). Dev bypass allows testing anytime voice is enabled.
  if (
    ctx.session.phase !== 'ENTRY' &&
    ctx.session.phase !== 'MANAGE' &&
    !liveVoiceDevBypassEnabled()
  ) {
    return {
      reacted: false,
      skippedReason: 'Reactions start at cash open',
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: null,
      price: null,
      sessionId: ctx.voiceSessionId,
    }
  }

  const price = Number(args.event.price)
  if (!(price > 0)) {
    return {
      reacted: false,
      skippedReason: 'Invalid level price',
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: null,
      price: null,
      sessionId: ctx.voiceSessionId,
    }
  }

  const session = await getOrCreateLiveVoiceSession(args.supabase, {
    userId: args.userId,
    instrument: ctx.voice.instrument,
    tradeDate: ctx.voice.tradeDate,
  })
  if (!session) {
    return {
      reacted: false,
      skippedReason: 'Could not open voice session',
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: null,
      price,
      sessionId: null,
    }
  }

  const dbPins = await loadLiveVoicePins(args.supabase, session.id, args.userId)
  const knownPin = [...ctx.userPins, ...dbPins].some(
    (p) => Math.abs(p.price - price) / price <= 0.0005
  )
  const knownAi = ctx.levels.items.some((l) => Math.abs(l.price - price) / price <= 0.0005)
  if (!knownPin && !knownAi) {
    return {
      reacted: false,
      skippedReason: 'Level not in desk pins or AI levels',
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: null,
      price,
      sessionId: session.id,
    }
  }

  const prior = await countReactionsForPrice(
    args.supabase,
    session.id,
    args.userId,
    price
  )
  if (prior >= LIVE_VOICE_MAX_REACTIONS_PER_LEVEL) {
    return {
      reacted: false,
      skippedReason: `Max ${LIVE_VOICE_MAX_REACTIONS_PER_LEVEL} reactions for this level`,
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: args.event.verdict,
      price,
      sessionId: session.id,
    }
  }

  let side = args.event.side
  if (!side) {
    const pin = [...ctx.userPins, ...dbPins].find(
      (p) => Math.abs(p.price - price) / price <= 0.0005
    )
    const ai = ctx.levels.items.find((l) => Math.abs(l.price - price) / price <= 0.0005)
    side = pin?.side ?? ai?.side ?? null
  }

  const tipPrice = Number(args.event.tipPrice)
  const verdictCheck = assertReactVerdictMatchesTip({
    tip: tipPrice,
    level: price,
    side,
    verdict: args.event.verdict,
  })
  if (!verdictCheck.ok) {
    return {
      reacted: false,
      skippedReason: verdictCheck.reason,
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: null,
      price,
      sessionId: session.id,
    }
  }

  const ev: LevelTagEvent = { ...args.event, price, tipPrice, side }
  const replyText = buildLevelTagReactionText(ev)
  const token = `level_tag:${Math.round(price * 100) / 100}:${ev.verdict}`

  const { error: turnErr } = await args.supabase.from('live_voice_turns').insert([
    {
      session_id: session.id,
      user_id: args.userId,
      role: 'system',
      text: `${token} tip=${ev.tipPrice}`,
    },
    {
      session_id: session.id,
      user_id: args.userId,
      role: 'assistant',
      text: replyText,
    },
  ])
  if (turnErr) {
    logger.warn('live_voice.reaction_persist_failed', { error: turnErr.message })
    return {
      reacted: false,
      skippedReason: 'Could not persist reaction',
      replyText: null,
      audioBase64: null,
      audioMime: null,
      verdict: ev.verdict,
      price,
      sessionId: session.id,
    }
  }

  let audioBase64: string | null = null
  let audioMime: string | null = null
  try {
    const mp3 = await synthesizeSpeechMp3(replyText)
    if (mp3?.length) {
      audioBase64 = mp3.toString('base64')
      audioMime = 'audio/mpeg'
    }
  } catch {
    /* browser TTS fallback on client */
  }

  return {
    reacted: true,
    skippedReason: null,
    replyText,
    audioBase64,
    audioMime,
    verdict: ev.verdict,
    price,
    sessionId: session.id,
  }
}

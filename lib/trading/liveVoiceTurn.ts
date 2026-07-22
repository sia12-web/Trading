/**
 * Live Voice turn runner: optional Whisper → desk LLM → optional TTS.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { llmComplete } from '@/lib/llm/complete'
import {
  isProviderConfigured,
  type LlmProvider,
} from '@/lib/llm/config'
import { logLlmUsage } from '@/lib/llm/usageLog'
import {
  isOpenAiSpeechConfigured,
  synthesizeSpeechMp3,
  transcribeAudioWithWhisper,
} from '@/lib/speech/openaiSpeech'
import { buildLiveVoiceDeskContext } from '@/lib/trading/liveVoiceContext'
import {
  LIVE_VOICE_SYSTEM_PROMPT,
  buildLiveVoiceUserMessage,
} from '@/lib/trading/liveVoicePrompt'
import {
  LIVE_VOICE_MAX_TRANSCRIPT_CHARS,
  sanitizeLiveVoiceTranscript,
  validateLiveVoiceAudioSize,
} from '@/lib/trading/liveVoiceGuards'
import {
  persistLiveVoiceTurn,
  type LiveVoicePin,
} from '@/lib/trading/liveVoiceSession'
import type { DeskInstrument } from '@/lib/trading/sessionGate'
import { logger } from '@/lib/utils/logger'

const MAX_REPLY_TOKENS = 220

/** Sonnet: solid co-pilot quality without Opus spend. Override with LIVE_VOICE_MODEL. */
export const DEFAULT_LIVE_VOICE_MODEL = 'claude-3-5-sonnet-20241022'

export type LiveVoiceTurnResult = {
  transcript: string
  replyText: string
  audioBase64: string | null
  audioMime: string | null
  speechConfigured: boolean
  instrument: DeskInstrument
  phase: string
  levelCount: number
  sessionId: string | null
  pins: LiveVoicePin[]
  newPins: LiveVoicePin[]
}

/** Live Voice prefers Anthropic, Gemini, or OpenAI based on config. */
export function voiceLlmProvider(): LlmProvider {
  const raw = process.env.LIVE_VOICE_PROVIDER?.trim().toLowerCase()
  if (raw === 'openai') return 'openai'
  if (raw === 'gemini' || raw === 'google') return 'gemini'
  return 'anthropic'
}

export function voiceLlmModel(): string {
  return (process.env.LIVE_VOICE_MODEL?.trim() || DEFAULT_LIVE_VOICE_MODEL).trim()
}

export async function runLiveVoiceTurn(args: {
  supabase: SupabaseClient
  userId: string
  instrument: DeskInstrument
  transcript?: string | null
  audio?: Buffer | null
  audioFilename?: string
  customPin?: {
    price: number
    side: 'BUY' | 'SHORT'
    reason: string
  } | null
}): Promise<LiveVoiceTurnResult> {
  const ctx = await buildLiveVoiceDeskContext(
    args.supabase,
    args.userId,
    args.instrument
  )

  if (!ctx.voice.clockedIn) {
    throw Object.assign(new Error('Clock in required for Live Voice'), { status: 403 })
  }
  if (!ctx.voice.enabled) {
    throw Object.assign(
      new Error(ctx.voice.reason || 'Live Voice window closed'),
      { status: 403, code: ctx.voice.disableCode }
    )
  }

  const audioCheck = validateLiveVoiceAudioSize(args.audio?.length)
  if (!audioCheck.ok) {
    throw Object.assign(new Error(audioCheck.reason || 'Audio too large'), { status: 413 })
  }

  let transcript = sanitizeLiveVoiceTranscript(args.transcript)
  if (!transcript && args.audio?.length) {
    transcript = sanitizeLiveVoiceTranscript(
      await transcribeAudioWithWhisper(args.audio, args.audioFilename || 'audio.webm')
    )
  }
  transcript = transcript.slice(0, LIVE_VOICE_MAX_TRANSCRIPT_CHARS).trim()
  if (!transcript) {
    throw Object.assign(
      new Error(
        isOpenAiSpeechConfigured()
          ? 'Could not hear that — try again'
          : 'No transcript — enable mic speech recognition or set OPENAI_API_KEY for Whisper'
      ),
      { status: 400 }
    )
  }

  const provider = voiceLlmProvider()
  const model = voiceLlmModel()
  if (!isProviderConfigured(provider)) {
    throw Object.assign(
      new Error(
        provider === 'anthropic'
          ? 'LLM not configured — set ANTHROPIC_API_KEY for Live Voice'
          : 'LLM not configured — set GEMINI_API_KEY (or use Anthropic default)'
      ),
      { status: 503 }
    )
  }

  let replyText = ''
  try {
    const result = await llmComplete({
      provider,
      model,
      system: LIVE_VOICE_SYSTEM_PROMPT,
      user: buildLiveVoiceUserMessage(transcript, ctx),
      maxTokens: MAX_REPLY_TOKENS,
      temperature: 0.35,
    })
    replyText = result.text.trim()
    await logLlmUsage({
      usage: result.usage,
      route: 'live_voice.turn',
      instrument: ctx.voice.instrument,
      success: true,
      meta: {
        transcript_chars: transcript.length,
        reply_chars: replyText.length,
        speech: isOpenAiSpeechConfigured(),
      },
    })
  } catch (err) {
    logger.error('live_voice.llm_failed', { err })
    await logLlmUsage({
      usage: {
        provider,
        model,
        role: 'proposer',
        input_tokens: 0,
        output_tokens: 0,
      },
      route: 'live_voice.turn',
      instrument: ctx.voice.instrument,
      success: false,
      errorMessage: err instanceof Error ? err.message : 'llm failed',
    })
    throw Object.assign(new Error('Co-pilot timed out — retry'), { status: 502 })
  }

  if (!replyText) {
    throw Object.assign(new Error('Empty co-pilot reply — retry'), { status: 502 })
  }

  // Soft length guard for speech
  const sentences = replyText.split(/(?<=[.!?])\s+/)
  if (sentences.length > 6) {
    replyText = sentences.slice(0, 5).join(' ')
  }

  let audioBase64: string | null = null
  let audioMime: string | null = null
  try {
    const mp3 = await synthesizeSpeechMp3(replyText)
    if (mp3?.length) {
      audioBase64 = mp3.toString('base64')
      audioMime = 'audio/mpeg'
    }
  } catch (err) {
    logger.warn('live_voice.tts_exception', { err })
  }

  const persisted = await persistLiveVoiceTurn({
    supabase: args.supabase,
    userId: args.userId,
    instrument: ctx.voice.instrument,
    tradeDate: ctx.voice.tradeDate,
    transcript,
    replyText,
    aiLevels: ctx.levels.items.map((l) => ({ price: l.price, side: l.side })),
    customPin: args.customPin,
  })

  return {
    transcript,
    replyText,
    audioBase64,
    audioMime,
    speechConfigured: isOpenAiSpeechConfigured(),
    instrument: ctx.voice.instrument,
    phase: ctx.session.phase,
    levelCount: ctx.levels.count,
    sessionId: persisted.sessionId,
    pins: persisted.pins,
    newPins: persisted.newPins,
  }
}

/**
 * POST /api/trading/live-voice/turn
 * Hold-to-talk turn: audio and/or transcript → desk LLM → optional TTS audio.
 *
 * multipart/form-data: instrument, audio (file), transcript (optional text fallback)
 * OR application/json: { instrument, transcript }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDeskUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import {
  LIVE_VOICE_TURN_LIMIT,
  LIVE_VOICE_TURN_WINDOW_MS,
  checkLiveVoiceRateLimit,
} from '@/lib/trading/liveVoiceGuards'
import { isLiveDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'
import { runLiveVoiceTurn } from '@/lib/trading/liveVoiceTurn'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

async function parseBody(request: Request): Promise<{
  instrument: DeskInstrument
  transcript: string | null
  audio: Buffer | null
  audioFilename: string
}> {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const instrumentRaw = String(form.get('instrument') || 'DOW')
    const instrument: DeskInstrument = isLiveDeskInstrument(instrumentRaw)
      ? instrumentRaw
      : 'DOW'
    const transcriptRaw = form.get('transcript')
    const transcript =
      typeof transcriptRaw === 'string' && transcriptRaw.trim()
        ? transcriptRaw.trim()
        : null
    const file = form.get('audio')
    let audio: Buffer | null = null
    let audioFilename = 'audio.webm'
    if (file && typeof file === 'object' && 'arrayBuffer' in file) {
      const f = file as File
      audio = Buffer.from(await f.arrayBuffer())
      audioFilename = f.name || audioFilename
    }
    return { instrument, transcript, audio, audioFilename }
  }

  const json = (await request.json().catch(() => null)) as {
    instrument?: string
    transcript?: string
  } | null
  const instrumentRaw = String(json?.instrument || 'DOW')
  const instrument: DeskInstrument = isLiveDeskInstrument(instrumentRaw)
    ? instrumentRaw
    : 'DOW'
  const transcript = String(json?.transcript || '').trim() || null
  return { instrument, transcript, audio: null, audioFilename: 'audio.webm' }
}

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'Audio payload exceeds maximum limit of 10MB' },
        { status: 413 }
      )
    }

    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    if (
      !checkLiveVoiceRateLimit(
        `turn:${user.id}`,
        LIVE_VOICE_TURN_LIMIT,
        LIVE_VOICE_TURN_WINDOW_MS
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Too many Live Voice turns — wait a minute' },
        { status: 429 }
      )
    }

    const body = await parseBody(request)
    logger.info('live_voice.turn_request_received', {
      userId: user.id,
      instrument: body.instrument,
      hasTranscript: Boolean(body.transcript),
      transcriptSnippet: body.transcript?.slice(0, 80),
      audioSizeBytes: body.audio?.length ?? 0,
      audioFilename: body.audioFilename,
    })

    const supabase = await createClient()
    const result = await runLiveVoiceTurn({
      supabase,
      userId: user.id,
      instrument: body.instrument,
      transcript: body.transcript,
      audio: body.audio,
      audioFilename: body.audioFilename,
    })

    logger.info('live_voice.turn_request_success', {
      userId: user.id,
      instrument: body.instrument,
      transcript: result.transcript,
      replySnippet: result.replyText.slice(0, 100),
      hasAudioResponse: Boolean(result.audioBase64),
      audioResponseBytes: result.audioBase64?.length ?? 0,
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as { status: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500
    const message = error instanceof Error ? error.message : 'Turn failed'
    if (status >= 500) {
      logger.error('live_voice.turn_failed', { err: error })
    }
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

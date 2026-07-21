/**
 * Optional OpenAI Whisper STT + TTS for Live Voice.
 * Uses REST fetch so we don't require the openai npm package.
 * When OPENAI_API_KEY is missing, callers use transcript text + browser TTS.
 */

import { logger } from '@/lib/utils/logger'

function openaiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim()
  return k || null
}

export function isOpenAiSpeechConfigured(): boolean {
  return Boolean(openaiKey())
}

export async function transcribeAudioWithWhisper(
  audio: Buffer,
  filename = 'audio.webm'
): Promise<string> {
  const key = openaiKey()
  if (!key) throw new Error('OPENAI_API_KEY not set — send transcript text instead')

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)]), filename)
  form.append('model', process.env.OPENAI_WHISPER_MODEL?.trim() || 'whisper-1')
  form.append('language', 'en')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    logger.error('live_voice.whisper_failed', { status: res.status, err: err.slice(0, 300) })
    throw new Error(`Speech-to-text failed (${res.status})`)
  }
  const json = (await res.json()) as { text?: string }
  const text = String(json.text || '').trim()
  if (!text) throw new Error('Empty transcription')
  return text
}

export async function synthesizeSpeechMp3(text: string): Promise<Buffer | null> {
  const key = openaiKey()
  if (!key) return null

  const model = process.env.OPENAI_TTS_MODEL?.trim() || 'tts-1'
  const voice = process.env.OPENAI_TTS_VOICE?.trim() || 'alloy'
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text.slice(0, 1200),
      response_format: 'mp3',
    }),
  })
  if (!res.ok) {
    // Fallback model name if mini-tts unavailable on account
    if (res.status === 400 || res.status === 404) {
      const retry = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: 'alloy',
          input: text.slice(0, 1200),
          response_format: 'mp3',
        }),
      })
      if (!retry.ok) {
        const err = await retry.text().catch(() => '')
        logger.warn('live_voice.tts_failed', { status: retry.status, err: err.slice(0, 200) })
        return null
      }
      return Buffer.from(await retry.arrayBuffer())
    }
    const err = await res.text().catch(() => '')
    logger.warn('live_voice.tts_failed', { status: res.status, err: err.slice(0, 200) })
    return null
  }
  return Buffer.from(await res.arrayBuffer())
}

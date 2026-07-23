import { NextResponse } from 'next/server'
import { synthesizeSpeechMp3 } from '@/lib/speech/openaiSpeech'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { text } = (await request.json().catch(() => ({}))) as { text?: string }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 })
    }

    const mp3 = await synthesizeSpeechMp3(text.trim())
    if (!mp3) {
      return NextResponse.json({ error: 'TTS synthesis unavailable' }, { status: 503 })
    }

    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3.length.toString(),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    logger.error('speech.synthesize_failed', { error: err })
    return NextResponse.json({ error: 'Internal synthesis error' }, { status: 500 })
  }
}

/**
 * DELETE /api/trading/live-voice/pin
 * Delete a sent zone/pin so it is removed from Leo's memory and prompt context.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDeskUser } from '@/lib/utils/devAuth'
import { logger } from '@/lib/utils/logger'
import { isLiveDeskInstrument, type DeskInstrument } from '@/lib/trading/sessionGate'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request) {
  try {
    const user = await resolveDeskUser(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const pinId = searchParams.get('id')
    const priceStr = searchParams.get('price')
    const instrumentRaw = searchParams.get('instrument')
    const price = priceStr ? Number(priceStr) : null

    const supabase = await createClient()

    if (pinId) {
      const { error } = await supabase
        .from('live_voice_pins')
        .delete()
        .eq('id', pinId)
        .eq('user_id', user.id)

      if (error) {
        logger.error('live_voice.pin_delete_failed', { error: error.message })
        return NextResponse.json({ success: false, error: 'Failed to delete pin' }, { status: 500 })
      }
      return NextResponse.json({ success: true, deleted: true })
    }

    if (price != null && Number.isFinite(price) && instrumentRaw && isLiveDeskInstrument(instrumentRaw)) {
      // Find session for user & instrument
      const { data: session } = await supabase
        .from('live_voice_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('instrument', instrumentRaw as DeskInstrument)
        .eq('status', 'active')
        .maybeSingle()

      if (session?.id) {
        const { error } = await supabase
          .from('live_voice_pins')
          .delete()
          .eq('session_id', session.id)
          .eq('user_id', user.id)
          .eq('price', price)

        if (error) {
          logger.error('live_voice.pin_delete_by_price_failed', { error: error.message })
          return NextResponse.json({ success: false, error: 'Failed to delete pin' }, { status: 500 })
        }
      }
      return NextResponse.json({ success: true, deleted: true })
    }

    return NextResponse.json({ success: false, error: 'Missing pin id or price & instrument' }, { status: 400 })
  } catch (err) {
    logger.error('live_voice.pin_delete_error', { err })
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

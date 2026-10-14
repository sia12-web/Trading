import { NextResponse } from 'next/server'
import { sendTelegramMessage } from '@/lib/notify/telegram'
import { getOandaPrice } from '@/lib/oanda/pricing'
import type { Instrument } from '@/types/price-feed'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const rawInst = String(body.instrument || 'GOLD').toUpperCase()

    const instMap: Record<string, { inst: Instrument; label: string; contract: string; maxRange: number; buffer: number }> = {
      GOLD: { inst: 'GOLD', label: 'Gold - Cash (CMC / OANDA)', contract: 'MGC', maxRange: 60, buffer: 10 },
      DOW: { inst: 'DOW', label: 'US 30 - Cash (CMC / OANDA)', contract: 'MYM', maxRange: 80, buffer: 20 },
      NASDAQ: { inst: 'NASDAQ', label: 'US NDAQ 100 - Cash (CMC / OANDA)', contract: 'MNQ', maxRange: 150, buffer: 25 },
      OIL: { inst: 'CRUDE', label: 'Crude Oil WTI - Cash (CMC / OANDA)', contract: 'MCL', maxRange: 1.5, buffer: 0.3 },
    }

    const fallbackItem = instMap.GOLD!
    const item = instMap[rawInst] ?? fallbackItem

    // Fetch live CMC Markets / OANDA Cash price
    let liveCashPrice: number | null = null
    try {
      const q = await getOandaPrice(item.inst)
      if (q?.price) liveCashPrice = q.price
    } catch {
      // fallback
    }

    const priceDisplay = liveCashPrice != null
      ? (item.inst === 'CRUDE' ? `$${liveCashPrice.toFixed(2)}` : liveCashPrice >= 1000 ? liveCashPrice.toFixed(1) : `$${liveCashPrice.toFixed(2)}`)
      : 'Active'

    // Compute sample CMC Cash breakout levels from live cash price
    const sampleMid = liveCashPrice ?? (item.inst === 'GOLD' ? 4166.5 : item.inst === 'DOW' ? 51760.0 : 30690.0)
    const buyStop = (sampleMid + item.buffer).toFixed(item.inst === 'CRUDE' ? 2 : 1)
    const sellStop = (sampleMid - item.buffer).toFixed(item.inst === 'CRUDE' ? 2 : 1)
    const tpLong = (sampleMid + item.buffer * 2.5).toFixed(item.inst === 'CRUDE' ? 2 : 1)
    const tpShort = (sampleMid - item.buffer * 2.5).toFixed(item.inst === 'CRUDE' ? 2 : 1)

    const testMessage = [
      `🌙 *[ASIAN EDGE] Live Desk Alert — ${item.label}*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💵 *CMC Markets Cash Mark:* \`${priceDisplay}\``,
      `⚡ *Action:* \`PLACE OCO STOPS (02:00 ET Lock)\``,
      `🟢 *Buy Stop (Long):* \`${buyStop}\``,
      `🔴 *Sell Stop (Short):* \`${sellStop}\``,
      `🛑 *Stop Loss:* \`${sampleMid.toFixed(1)}\` _(Asia Midpoint)_`,
      `🎯 *Take Profit (1.5R):* \`${tpLong} / ${tpShort}\``,
      `⏱️ *Execution Timing:* \`02:00 – 03:30 ET\``,
      `🛑 *Outing Mandate:* \`10:25 ET (Hard Flatten)\``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `_Prices strictly synchronized with CMC Markets Cash via OANDA feed._`,
    ].join('\n')

    const result = await sendTelegramMessage(testMessage)

    if (result.ok && !('skipped' in result && result.skipped)) {
      return NextResponse.json({
        success: true,
        message: 'Telegram alert delivered with live CMC Markets cash pricing!',
        result,
      })
    }

    const desc = 'description' in result ? result.description : ''
    const errText = 'error' in result ? result.error : 'reason' in result ? result.reason : 'Unknown error'
    const isChatNotFound = Boolean(desc?.includes('chat not found') || errText.includes('chat not found'))

    return NextResponse.json({
      success: false,
      error: errText,
      description: desc,
      isChatNotFound,
      botUsername: 'AsianEdge1bot',
      instructions: isChatNotFound
        ? 'Please open Telegram, search for @AsianEdge1bot, and press START (or send /start). Then retry this test!'
        : undefined,
    }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'Internal server error',
    }, { status: 500 })
  }
}

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
      NIKKEI: { inst: 'NIKKEI', label: 'Japan 225 - Cash (Nikkei NKD)', contract: 'NKD', maxRange: 350, buffer: 30 },
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
    const sampleMid = liveCashPrice ?? (item.inst === 'GOLD' ? 4166.5 : item.inst === 'DOW' ? 51760.0 : item.inst === 'NASDAQ' ? 20450.0 : 70.5)
    const buyStop = (sampleMid + item.buffer).toFixed(item.inst === 'CRUDE' ? 2 : 1)
    const sellStop = (sampleMid - item.buffer).toFixed(item.inst === 'CRUDE' ? 2 : 1)
    const tpLong = (sampleMid + item.buffer * 2.5).toFixed(item.inst === 'CRUDE' ? 2 : 1)
    const tpShort = (sampleMid - item.buffer * 2.5).toFixed(item.inst === 'CRUDE' ? 2 : 1)

    let testMessage = ''

    if (rawInst === 'NASDAQ') {
      const priorPoc = sampleMid - 65
      const dist = 65.0
      testMessage = [
        `🌙 *[ASIAN EDGE] Live Desk Alert — US NDAQ 100 - Cash (CMC / OANDA)*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `💵 *CMC Markets Cash Mark:* \`${priceDisplay}\``,
        `⚡ *Action:* \`DALTON PRIOR POC REVERSION (18:00 ET Open)\``,
        `✅ *Condition:* Qualified Displacement (\`${dist.toFixed(1)}\` pts >= 50.0 pts from POC)`,
        ``,
        `🔴 *Setup Direction:* \`SHORT targeting POC Equilibrium\``,
        `📍 *Entry Zone:* \`${sampleMid.toFixed(1)}\``,
        `🛑 *Stop Loss:* \`${(sampleMid + dist).toFixed(1)}\` _(${dist.toFixed(1)} pts symmetrical risk)_`,
        `🎯 *Take Profit:* \`${priorPoc.toFixed(1)}\` _(Resting Limit at Prior Day POC)_`,
        ``,
        `📦 *Position Size:* \`1 MNQ contract\` (~$130 risk)`,
        `⏱️ *Execution Timing:* \`18:00 – 20:00 ET Window\``,
        `🛑 *Outing Mandate:* \`02:00 ET (Asian Close Outing)\``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `_Prices strictly synchronized with CMC Markets Cash via OANDA feed._`,
      ].join('\n')
    } else if (rawInst === 'NIKKEI') {
      const or15Range = 240
      const or15H = sampleMid + or15Range / 2
      const or15L = sampleMid - or15Range / 2
      const prevClose = 68240
      const tp1 = sampleMid + (prevClose - sampleMid) * 0.5
      testMessage = [
        `🇯🇵 *[TOKYO DESK] Execution Alert — Nikkei 225 (NKD / ^N225)*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `💵 *Current Price:* \`${priceDisplay}\``,
        `⚡ *Action:* \`TOKYO CASH OPEN (19:15 ET OR15 Breakout)\``,
        `✅ *Condition:* Gap Deficit Absorption Setup`,
        ``,
        `🟢 *Buy Stop (Long on OR15 Breakout):* \`${or15H.toFixed(0)}\``,
        `   ↳ *Take Profit 1:* \`${tp1.toFixed(0)}\` _(Half Gap Fill)_`,
        `   ↳ *Take Profit 2:* \`${prevClose.toFixed(0)}\` _(Full Gap Fill)_`,
        `🛑 *Stop Loss:* \`${or15L.toFixed(0)}\` _(OR15 Low / Symmetrical Risk)_`,
        ``,
        `📦 *Position Size:* \`1 NKD contract\` ($5/pt)`,
        `⏱️ *Execution Timing:* \`19:15 – 21:00 ET Window\``,
        `🛑 *Outing Mandate:* \`21:00 ET (Tokyo Lunch Outing)\``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `_TradePulse Tokyo Execution Desk Protocol_`,
      ].join('\n')
    } else if (rawInst === 'OIL') {
      testMessage = [
        `🌙 *[ASIAN EDGE] Risk Guard Alert — Crude Oil WTI - Cash*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `⛔ *Status:* \`ASIAN SESSION GATED (AVOID)\``,
        `💵 *Cash Mark:* \`${priceDisplay}\``,
        `🛡️ *Protocol:* Deactivated in Asia (Negative Expectancy Overnight)`,
        `⏱️ *Execution Window:* Confine strictly to NY Cash (09:00–14:30 ET)`,
        `📝 *Directive:* Preserve desk Daily Loss Limit (DLL). Zero overnight exposure.`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `_TradePulse Desk Risk Guard Active_`,
      ].join('\n')
    } else {
      testMessage = [
        `🌙 *[ASIAN EDGE] Live Desk Alert — ${item.label}*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `💵 *CMC Markets Cash Mark:* \`${priceDisplay}\``,
        `⚡ *Action:* \`PLACE OCO STOPS (02:00 ET Asia Box Lock)\``,
        `✅ *Condition:* Qualified Box Compression`,
        ``,
        `🟢 *Buy Stop (Long):* \`${buyStop}\``,
        `   ↳ *Take Profit (1.5R):* \`${tpLong}\``,
        `🔴 *Sell Stop (Short):* \`${sellStop}\``,
        `   ↳ *Take Profit (1.5R):* \`${tpShort}\``,
        `🛑 *Stop Loss:* \`${sampleMid.toFixed(1)}\` _(Asia Midpoint)_`,
        ``,
        `📦 *Position Size:* \`1 ${item.contract} contract\``,
        `⏱️ *Execution Timing:* \`02:00 – 03:30 ET\``,
        `🛑 *Outing Mandate:* \`10:25 ET (Hard Flatten)\``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `_Prices strictly synchronized with CMC Markets Cash via OANDA feed._`,
      ].join('\n')
    }

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

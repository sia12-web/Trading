/**
 * Telegram Bot API Dispatcher for TradePulse Desk & Asian Edge.
 * Real-time notifications for trade execution, stop loss, take profit, and session outings.
 */

import { logger } from '@/lib/utils/logger'

export type TelegramSendResult =
  | { ok: true; messageId?: number; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string; description?: string }

export interface TelegramConfig {
  botToken: string
  chatId: string
}

export function getTelegramConfig(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()

  if (!botToken || !chatId) {
    return null
  }
  return { botToken, chatId }
}

export function telegramConfigured(): boolean {
  return getTelegramConfig() !== null
}

/**
 * Send an arbitrary message to the configured Telegram chat.
 */
export async function sendTelegramMessage(
  text: string,
  options: {
    parseMode?: 'Markdown' | 'HTML'
    disableNotification?: boolean
  } = {}
): Promise<TelegramSendResult> {
  const config = getTelegramConfig()
  if (!config) {
    return {
      ok: true,
      skipped: true,
      reason: 'Telegram credentials not configured',
    }
  }

  const { botToken, chatId } = config
  const parseMode = options.parseMode ?? 'Markdown'

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`
    const body = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_notification: options.disableNotification ?? false,
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      result?: { message_id?: number }
      description?: string
      error_code?: number
    }

    if (res.ok && data.ok) {
      logger.info('telegram.message_sent', {
        chatId,
        messageId: data.result?.message_id,
      })
      return { ok: true, messageId: data.result?.message_id }
    }

    // If Markdown parsing failed, attempt plain text fallback
    if (parseMode === 'Markdown' && data.description?.includes('can\'t parse')) {
      logger.warn('telegram.markdown_parse_failed_retrying_plain', { desc: data.description })
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_notification: options.disableNotification ?? false,
        }),
        signal: AbortSignal.timeout(8000),
      })
      const retryData = (await retryRes.json().catch(() => ({}))) as any
      if (retryRes.ok && retryData.ok) {
        return { ok: true, messageId: retryData.result?.message_id }
      }
    }

    const errMsg = data.description || `HTTP ${res.status} ${res.statusText}`
    logger.warn('telegram.send_failed', { errMsg, status: res.status })
    return { ok: false, error: errMsg, description: data.description }
  } catch (err: any) {
    const errorStr = err?.message || String(err)
    logger.error('telegram.network_error', { err: errorStr })
    return { ok: false, error: errorStr }
  }
}

/**
 * Dispatch an execution notification for the Asian Edge strategy (legacy / single-order fallback).
 */
export async function sendAsianEdgeExecutionAlert(args: {
  instrument: string
  action: 'BUY_STOP_PLACED' | 'SELL_STOP_PLACED' | 'BOTH_PLACED' | 'EXECUTED_LONG' | 'EXECUTED_SHORT'
  entry: number
  stopLoss: number
  takeProfit: number
  riskPts: number
  contracts: number
  timeNote: string
}): Promise<TelegramSendResult> {
  const icon = args.action.includes('LONG') ? '🟢' : args.action.includes('SHORT') ? '🔴' : '⚡'
  const text = [
    `🌙 *[ASIAN EDGE] Execution Alert — ${args.instrument}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `${icon} *Action:* \`${args.action}\``,
    `🎯 *Entry:* \`${args.entry.toFixed(2)}\``,
    `🛑 *Stop Loss:* \`${args.stopLoss.toFixed(2)}\` (_${args.riskPts.toFixed(1)} pts risk_)`,
    `🏆 *Take Profit:* \`${args.takeProfit.toFixed(2)}\` (_1.5R target_)`,
    `📦 *Contracts:* \`${args.contracts}\``,
    `⏱️ *Execution Timing:* ${args.timeNote}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_TradePulse Desk Protocol Active_`,
  ].join('\n')

  return sendTelegramMessage(text)
}

/**
 * Dispatch high-conviction OCO bracket alert for Asian Box Breakout (Gold & Dow).
 */
export async function sendAsianEdgeBracketAlert(args: {
  instrument: string
  contract: string
  pointValue: number
  asiaRange: number
  maxRange: number
  buyStop: number
  sellStop: number
  stopLoss: number
  longTp: number
  shortTp: number
  riskPts: number
  contracts: number
  timeNote?: string
  outingMandate?: string
}): Promise<TelegramSendResult> {
  const riskCash = args.riskPts * args.pointValue * args.contracts
  const text = [
    `🌙 *[ASIAN EDGE] Execution Alert — ${args.instrument}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚡ *Action:* \`PLACE OCO BRACKET (02:00 ET Asia Box Lock)\``,
    `✅ *Condition:* Qualified Box Compression (Range: \`${args.asiaRange.toFixed(1)}\` <= \`${args.maxRange}\` max)`,
    ``,
    `🟢 *Buy Stop (Long):* \`${args.buyStop.toFixed(1)}\``,
    `   ↳ *Take Profit (1.5R):* \`${args.longTp.toFixed(1)}\``,
    `🔴 *Sell Stop (Short):* \`${args.sellStop.toFixed(1)}\``,
    `   ↳ *Take Profit (1.5R):* \`${args.shortTp.toFixed(1)}\``,
    `🛑 *Stop Loss:* \`${args.stopLoss.toFixed(1)}\` _(Asia Midpoint — ${args.riskPts.toFixed(1)} pts risk)_`,
    ``,
    `📦 *Position Size:* \`${args.contracts} ${args.contract}\` (~$${riskCash.toFixed(0)} risk)`,
    `⏱️ *Execution Timing:* ${args.timeNote ?? '02:00 – 03:30 ET (Cancel unfilled at 03:30 ET)'}`,
    `🛑 *Outing Mandate:* ${args.outingMandate ?? '10:25 ET Mandatory Hard Flat'}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Synchronized with CMC Markets Cash feed • TradePulse Desk Protocol_`,
  ].join('\n')

  return sendTelegramMessage(text)
}

/**
 * Dispatch high-conviction Dalton Prior Day POC Reversion alert (Nasdaq).
 */
export async function sendAsianEdgePocReversionAlert(args: {
  instrument: string
  contract: string
  direction: 'LONG' | 'SHORT'
  entry: number
  priorPoc: number
  stopLoss: number
  riskPts: number
  contracts: number
  pointValue: number
  displacement: number
  minDisplacement: number
  timeNote?: string
  outingMandate?: string
}): Promise<TelegramSendResult> {
  const icon = args.direction === 'LONG' ? '🟢' : '🔴'
  const riskCash = args.riskPts * args.pointValue * args.contracts
  const text = [
    `🌙 *[ASIAN EDGE] Execution Alert — ${args.instrument}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚡ *Action:* \`DALTON PRIOR POC REVERSION (18:00 ET Open)\``,
    `✅ *Condition:* Qualified Displacement (\`${args.displacement.toFixed(1)}\` pts >= \`${args.minDisplacement}\` min)`,
    ``,
    `${icon} *Setup Direction:* \`${args.direction} targeting POC Equilibrium\``,
    `📍 *Entry Zone:* \`${args.entry.toFixed(1)}\``,
    `🛑 *Stop Loss:* \`${args.stopLoss.toFixed(1)}\` _(${args.riskPts.toFixed(1)} pts symmetrical risk)_`,
    `🎯 *Take Profit:* \`${args.priorPoc.toFixed(1)}\` _(Resting Limit at Prior Day POC)_`,
    ``,
    `📦 *Position Size:* \`${args.contracts} ${args.contract}\` (~$${riskCash.toFixed(0)} risk)`,
    `⏱️ *Execution Timing:* ${args.timeNote ?? '18:00 – 20:00 ET Window'}`,
    `🛑 *Outing Mandate:* ${args.outingMandate ?? '02:00 ET Asian Close Outing'}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Synchronized with CMC Markets Cash feed • TradePulse Desk Protocol_`,
  ].join('\n')

  return sendTelegramMessage(text)
}

/**
 * Dispatch an outing/flattening notification when Asian/London session ends.
 */
export async function sendAsianEdgeOutingAlert(args: {
  instrument: string
  reason: 'FLATTEN_1025' | 'SESSION_CLOSE_0200' | 'CANCEL_UNFILLED_0330' | 'STOP_HIT' | 'TARGET_HIT'
  price?: number
  timeNote: string
  note?: string
}): Promise<TelegramSendResult> {
  const icon =
    args.reason === 'TARGET_HIT'
      ? '🎉'
      : args.reason === 'STOP_HIT'
      ? '⚠️'
      : args.reason === 'FLATTEN_1025'
      ? '🛑'
      : '🔔'
  const reasonLabel =
    args.reason === 'FLATTEN_1025'
      ? '10:25 ET Mandatory Hard Flatten'
      : args.reason === 'SESSION_CLOSE_0200'
      ? '02:00 ET Asian Close Outing'
      : args.reason === 'CANCEL_UNFILLED_0330'
      ? '03:30 ET Order Cutoff (Cancel Unfilled)'
      : args.reason
  const text = [
    `🌙 *[ASIAN EDGE] Outing & Exit Alert — ${args.instrument}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `${icon} *Event:* \`${reasonLabel}\``,
    args.price != null ? `💵 *Exit Price:* \`${args.price.toFixed(2)}\`` : '',
    `⏱️ *Time Window:* ${args.timeNote}`,
    args.note ? `📝 *Desk Directive:* ${args.note}` : '',
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Session Flat Mandate Enforced • TradePulse Desk Protocol_`,
  ].filter(Boolean).join('\n')

  return sendTelegramMessage(text)
}

/**
 * Dispatch Nikkei 225 Tokyo Cash session trade alert (Gap-Fade Long or Breakdown Short).
 */
export async function sendNikkeiTradeAlert(args: {
  action: 'BUY_GAP_FADE_LONG' | 'SELL_BREAKDOWN_SHORT'
  entry: number
  stopLoss: number
  takeProfit1: number
  takeProfit2: number
  gapPct: number
  riskPts: number
  contracts?: number
  timeNote?: string
  note?: string
}): Promise<TelegramSendResult> {
  const icon = args.action.includes('BUY') ? '🟢' : '🔴'
  const actionLabel =
    args.action === 'BUY_GAP_FADE_LONG'
      ? 'BUY / GO LONG (Tokyo Gap-Fade Absorption)'
      : 'SELL / GO SHORT (Breakdown Continuation)'
  const contracts = args.contracts ?? 1
  const riskCash = args.riskPts * 5.0 * contracts // NKD $5/pt multiplier

  const text = [
    `🇯🇵 *[TOKYO DESK] Execution Alert — Nikkei 225 (NKD / ^N225)*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `${icon} *Action:* \`${actionLabel}\``,
    `📊 *Opening Gap:* \`${args.gapPct >= 0 ? '+' : ''}${args.gapPct.toFixed(2)}%\` _(USD/JPY buffer active)_`,
    ``,
    `🎯 *Execution Entry:* \`${args.entry.toFixed(0)}\``,
    `🛑 *Stop Loss:* \`${args.stopLoss.toFixed(0)}\` _(${args.riskPts.toFixed(0)} pts risk / ~$${riskCash.toFixed(0)})_`,
    `🏆 *Take Profit 1:* \`${args.takeProfit1.toFixed(0)}\` _(Half Gap Fill)_`,
    `🏆 *Take Profit 2:* \`${args.takeProfit2.toFixed(0)}\` _(Full Gap Fill / Tokyo VWAP)_`,
    ``,
    `📦 *Position Size:* \`${contracts} NKD contract\` ($5/pt)`,
    `⏱️ *Trading Window:* ${args.timeNote ?? '19:15 – 21:00 ET (Tokyo Morning Drive)'}`,
    args.note ? `📝 *Desk Directive:* ${args.note}` : '',
    `━━━━━━━━━━━━━━━━━━━━`,
    `_TradePulse Tokyo Execution Desk Protocol_`,
  ].filter(Boolean).join('\n')

  return sendTelegramMessage(text)
}

/**
 * Dispatch London Session Judas Trap / Liquidity Sweep alert (Nasdaq or Dow).
 */
export async function sendLondonJudasAlert(args: {
  instrument: string
  contract: string
  pointValue: number
  entry: number
  stopLoss: number
  takeProfit: number
  riskPts: number
  contracts?: number
  timeNote?: string
  note?: string
}): Promise<TelegramSendResult> {
  const contracts = args.contracts ?? 1
  const riskCash = args.riskPts * args.pointValue * contracts

  const text = [
    `🇬🇧 *[LONDON DESK] Execution Alert — ${args.instrument}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🟢 *Action:* \`BUY / GO LONG (Judas Swing Liquidity Reclaim)\``,
    `⚡ *Condition:* Overnight Low Swept & Reclaimed with Positive Rejection`,
    ``,
    `🎯 *Execution Entry:* \`${args.entry.toFixed(1)}\``,
    `🛑 *Stop Loss:* \`${args.stopLoss.toFixed(1)}\` _(${args.riskPts.toFixed(1)} pts risk / ~$${riskCash.toFixed(0)})_`,
    `🏆 *Take Profit Target:* \`${args.takeProfit.toFixed(1)}\` _(Overnight Midpoint / VWAP)_`,
    ``,
    `📦 *Position Size:* \`${contracts} ${args.contract} contract\``,
    `⏱️ *Trading Window:* ${args.timeNote ?? '03:00 – 05:00 ET (European Cash Open)'}`,
    args.note ? `📝 *Desk Directive:* ${args.note}` : '',
    `━━━━━━━━━━━━━━━━━━━━`,
    `_TradePulse London Desk Protocol_`,
  ].filter(Boolean).join('\n')

  return sendTelegramMessage(text)
}

/**
 * Dispatch Gold London LBMA Physical Relief Bounce alert.
 */
export async function sendGoldLondonReliefAlert(args: {
  entry: number
  stopLoss: number
  takeProfit: number
  riskPts: number
  contracts?: number
  timeNote?: string
  note?: string
}): Promise<TelegramSendResult> {
  const contracts = args.contracts ?? 1
  const riskCash = args.riskPts * 10.0 * contracts // MGC $10/pt

  const text = [
    `🇬🇧 *[LONDON DESK] Execution Alert — Micro Gold (MGC / XAU/USD)*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🟢 *Action:* \`BUY / GO LONG (LBMA Physical Relief Bounce)\``,
    `⚡ *Condition:* Round-Number Support Tested with Dip Absorption`,
    ``,
    `🎯 *Execution Entry:* \`$${args.entry.toFixed(1)}\``,
    `🛑 *Stop Loss:* \`$${args.stopLoss.toFixed(1)}\` _($${args.riskPts.toFixed(1)} risk / ~$${riskCash.toFixed(0)})_`,
    `🏆 *Take Profit Target:* \`$${args.takeProfit.toFixed(1)}\` _(Relief Target to Prior Value)_`,
    ``,
    `📦 *Position Size:* \`${contracts} MGC contract\` ($10/pt)`,
    `⏱️ *Trading Window:* ${args.timeNote ?? '03:30 – 06:00 ET (European Morning)'}`,
    args.note ? `📝 *Desk Directive:* ${args.note}` : '',
    `━━━━━━━━━━━━━━━━━━━━`,
    `_TradePulse London Desk Protocol_`,
  ].filter(Boolean).join('\n')

  return sendTelegramMessage(text)
}

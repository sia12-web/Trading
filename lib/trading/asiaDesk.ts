/**
 * Live Asia overnight book — locked Pine recipes (Dow <80/20 MYM, Gold <60/10 MGC).
 * Telegram + Trade Pulse OCO overlay. Tradovate tickets stay manual.
 */

import {
  ASIA_ACCOUNT,
  ASIA_FILL_CUTOFF_MINS,
  ASIA_FLAT_MINS,
  ASIA_LOCK_MINS,
  ASIA_OPEN_MINS,
  ASIA_RISK_PCT,
  ASIA_TZ,
  asiaPreset,
  asiaQty,
  lockLatestAsiaSession,
  montrealCivil,
  type AsiaBar,
  type AsiaInstrument,
  type AsiaSession,
  type AsiaSkipReason,
} from '@/lib/trading/asiaRangeSignals'

export type { AsiaInstrument }

export const ASIA_DESK_INSTRUMENTS: AsiaInstrument[] = ['DOW', 'GOLD']

export const ASIA_DESK_RECIPES: Record<
  AsiaInstrument,
  { maxRange: number; buffer: number; contract: string }
> = {
  DOW: { maxRange: 80, buffer: 20, contract: 'MYM' },
  GOLD: { maxRange: 60, buffer: 10, contract: 'MGC' },
}

/** Chart page unlock: 02:00–10:25 Montreal weekdays (place after lock, flatten 10:25). */
export const ASIA_CHART_START_MINS = ASIA_LOCK_MINS
export const ASIA_CHART_END_MINS = ASIA_FLAT_MINS

/** Live tip: 02:00–03:40 only — don’t print through the 08:00 NY pre-focus freeze. */
export const ASIA_STREAM_END_MINS = ASIA_FILL_CUTOFF_MINS + 10

export type AsiaDeskEvent =
  | 'building'
  | 'place_both'
  | 'skip'
  | 'cancel_unfilled'
  | 'flatten'
  | 'idle'

export type AsiaDeskOverlay = {
  instrument: AsiaInstrument
  lockDate: string
  lockUnix: number
  event: AsiaDeskEvent
  qualified: boolean
  skipReason: AsiaSkipReason | 'ok'
  asiaHigh: number
  asiaLow: number
  asiaRange: number
  asiaMid: number
  buyStop: number
  sellStop: number
  longTp: number
  shortTp: number
  contracts: number
  contract: string
  maxRange: number
  buffer: number
  riskCash: number
  source: 'oanda' | 'tradingview' | 'manual'
  updatedAt: string
}

export type AsiaDeskBook = Partial<Record<AsiaInstrument, AsiaDeskOverlay>>

const weekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ASIA_TZ,
  weekday: 'short',
})

export function isAsiaDeskInstrument(
  instrument: string | null | undefined
): instrument is AsiaInstrument {
  return instrument === 'DOW' || instrument === 'GOLD'
}

export function isAsiaMontrealWeekday(now: Date = new Date()): boolean {
  const w = weekdayFmt.format(now)
  return w !== 'Sat' && w !== 'Sun'
}

export function asiaMontrealMins(now: Date = new Date()): { ymd: string; mins: number } {
  return montrealCivil(Math.floor(now.getTime() / 1000))
}

/** GOLD / DOW live chart page 02:00–10:25 Montreal weekdays. */
export function isAsiaDeskChartWindow(now: Date = new Date()): boolean {
  if (!isAsiaMontrealWeekday(now)) return false
  const { mins } = asiaMontrealMins(now)
  return mins >= ASIA_CHART_START_MINS && mins < ASIA_CHART_END_MINS
}

/** GOLD / DOW live tip during the place window only (02:00–03:40). */
export function isAsiaDeskStreamWindow(now: Date = new Date()): boolean {
  if (!isAsiaMontrealWeekday(now)) return false
  const { mins } = asiaMontrealMins(now)
  return mins >= ASIA_CHART_START_MINS && mins < ASIA_STREAM_END_MINS
}

/** Railway scan + place Telegram: 02:00–03:40 Montreal weekdays. */
export function isAsiaDeskScanWindow(now: Date = new Date()): boolean {
  if (!isAsiaMontrealWeekday(now)) return false
  const { mins } = asiaMontrealMins(now)
  return mins >= ASIA_LOCK_MINS && mins < ASIA_FILL_CUTOFF_MINS + 10
}

export function isAsiaDeskFlattenWindow(now: Date = new Date()): boolean {
  if (!isAsiaMontrealWeekday(now)) return false
  const { mins } = asiaMontrealMins(now)
  return mins >= ASIA_FLAT_MINS && mins < ASIA_FLAT_MINS + 15
}

export function asiaDeskEventForClock(
  session: AsiaSession | null,
  now: Date = new Date()
): AsiaDeskEvent {
  if (!isAsiaMontrealWeekday(now)) return 'idle'
  const { ymd, mins } = asiaMontrealMins(now)
  if (mins >= ASIA_OPEN_MINS || mins < ASIA_LOCK_MINS) return 'building'
  if (!session || session.lockDate !== ymd) {
    if (mins >= ASIA_LOCK_MINS && mins < ASIA_FILL_CUTOFF_MINS) return 'idle'
    return 'idle'
  }
  if (mins >= ASIA_FLAT_MINS && mins < ASIA_OPEN_MINS) return 'flatten'
  if (mins >= ASIA_FILL_CUTOFF_MINS) return 'cancel_unfilled'
  return session.qualified ? 'place_both' : 'skip'
}

export function overlayFromSession(args: {
  instrument: AsiaInstrument
  session: AsiaSession
  event: AsiaDeskEvent
  source: AsiaDeskOverlay['source']
}): AsiaDeskOverlay {
  const recipe = ASIA_DESK_RECIPES[args.instrument]
  const preset = asiaPreset(args.instrument)
  const qty =
    args.session.contracts > 0
      ? args.session.contracts
      : asiaQty(args.session.riskPts, preset.pointValue)
  return {
    instrument: args.instrument,
    lockDate: args.session.lockDate,
    lockUnix: args.session.lockUnix,
    event: args.event,
    qualified: args.session.qualified,
    skipReason: args.session.skipReason,
    asiaHigh: args.session.asiaHigh,
    asiaLow: args.session.asiaLow,
    asiaRange: args.session.asiaRange,
    asiaMid: args.session.asiaMid,
    buyStop: args.session.buyStop,
    sellStop: args.session.sellStop,
    longTp: args.session.longTp,
    shortTp: args.session.shortTp,
    contracts: Math.max(args.session.qualified ? 1 : 0, qty),
    contract: recipe.contract,
    maxRange: recipe.maxRange,
    buffer: recipe.buffer,
    riskCash: ASIA_ACCOUNT * (ASIA_RISK_PCT / 100),
    source: args.source,
    updatedAt: new Date().toISOString(),
  }
}

export function evaluateAsiaDeskOverlay(args: {
  instrument: AsiaInstrument
  candles: AsiaBar[]
  now?: Date
  source?: AsiaDeskOverlay['source']
}): AsiaDeskOverlay | null {
  const now = args.now ?? new Date()
  const recipe = ASIA_DESK_RECIPES[args.instrument]
  const session = lockLatestAsiaSession({
    instrument: args.instrument,
    candles: args.candles,
    maxRange: recipe.maxRange,
    buffer: recipe.buffer,
    nowUnix: Math.floor(now.getTime() / 1000),
  })
  const event = asiaDeskEventForClock(session, now)
  if (!session) return null
  const { ymd } = asiaMontrealMins(now)
  if (session.lockDate !== ymd && event !== 'building') return null
  if (event === 'idle' || event === 'building') return null
  return overlayFromSession({
    instrument: args.instrument,
    session,
    event,
    source: args.source ?? 'oanda',
  })
}

/** Chart / badge: only after 02:00 lock, only when the range recipe qualifies. */
export function isAsiaLiveOrderOverlay(
  overlay: AsiaDeskOverlay | null | undefined,
  now: Date = new Date()
): overlay is AsiaDeskOverlay {
  if (!overlay || !overlay.qualified || overlay.event !== 'place_both') return false
  const { ymd, mins } = asiaMontrealMins(now)
  if (overlay.lockDate !== ymd) return false
  return mins >= ASIA_LOCK_MINS && mins < ASIA_FILL_CUTOFF_MINS
}

function fmtPx(instrument: AsiaInstrument, n: number): string {
  if (!Number.isFinite(n)) return '—'
  return instrument === 'GOLD' ? n.toFixed(1) : String(Math.round(n))
}

export function asiaTelegramKey(overlay: AsiaDeskOverlay): string {
  return `${overlay.instrument}:${overlay.lockDate}:${overlay.event}`
}

export function formatAsiaDeskTelegram(overlay: AsiaDeskOverlay): string | null {
  const px = (n: number) => fmtPx(overlay.instrument, n)
  const head = overlay.instrument === 'GOLD' ? 'GOLD ASIA' : 'DOW ASIA'
  if (overlay.event === 'place_both' && overlay.qualified) {
    return [
      `${head} — PLACE OCO STOPS`,
      `${overlay.contract} x ${overlay.contracts}`,
      `Risk $${overlay.riskCash.toFixed(0)} (1% of ${ASIA_ACCOUNT.toLocaleString('en-US')})`,
      '',
      `LONG buy-stop ${px(overlay.buyStop)}`,
      `  SL ${px(overlay.asiaMid)}  TP ${px(overlay.longTp)}`,
      '',
      `SHORT sell-stop ${px(overlay.sellStop)}`,
      `  SL ${px(overlay.asiaMid)}  TP ${px(overlay.shortTp)}`,
      '',
      `Range ${overlay.asiaRange.toFixed(2)}  need < ${overlay.maxRange}  buffer ${overlay.buffer}`,
      `Cancel unfilled 03:30  Flatten 10:25 Montreal`,
      `Trade Pulse chart unlocked — both stops drawn on ${overlay.instrument}.`,
    ].join('\n')
  }
  if (overlay.event === 'skip') {
    return `${head} SKIP range ${overlay.asiaRange.toFixed(2)} (need < ${overlay.maxRange})`
  }
  if (overlay.event === 'cancel_unfilled') {
    return `03:30 Montreal — cancel unfilled ${overlay.instrument === 'GOLD' ? 'Gold' : 'Dow'} Asia stops. Keep SL/TP if already filled.`
  }
  if (overlay.event === 'flatten') {
    return `10:25 Montreal — flatten open ${overlay.instrument === 'GOLD' ? 'Gold' : 'Dow'} Asia trade.`
  }
  return null
}

export type AsiaWebhookPayload = {
  v?: number
  kind?: string
  instrument?: string
  event?: string
  asiaHigh?: number
  asiaLow?: number
  asiaRange?: number
  asiaMid?: number
  buyStop?: number
  sellStop?: number
  longTp?: number
  shortTp?: number
  contracts?: number
  text?: string
}

export function parseAsiaWebhookBody(raw: string): AsiaWebhookPayload | null {
  const text = String(raw || '').trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text) as AsiaWebhookPayload
      if (json && (json.kind === 'asia' || json.instrument === 'GOLD' || json.instrument === 'DOW')) {
        return json
      }
    } catch {
      /* fall through to text parse */
    }
  }
  const upper = text.toUpperCase()
  const instrument: AsiaInstrument | null = upper.includes('GOLD')
    ? 'GOLD'
    : upper.includes('DOW')
      ? 'DOW'
      : null
  if (!instrument && !/03:30|10:25|11:30/.test(upper)) return null
  let event: AsiaDeskEvent = 'idle'
  if (/PLACE/.test(upper)) event = 'place_both'
  else if (/SKIP/.test(upper)) event = 'skip'
  else if (/03:30/.test(upper)) event = 'cancel_unfilled'
  else if (/10:25|11:30/.test(upper)) event = 'flatten'
  if (event === 'idle') return null
  return { v: 1, kind: 'asia', instrument: instrument ?? undefined, event, text }
}

export function overlayFromWebhook(
  payload: AsiaWebhookPayload,
  fallback?: AsiaDeskOverlay | null
): AsiaDeskOverlay | null {
  const instrument = isAsiaDeskInstrument(payload.instrument)
    ? payload.instrument
    : fallback?.instrument ?? null
  if (!instrument) return null
  const recipe = ASIA_DESK_RECIPES[instrument]
  const event = (payload.event as AsiaDeskEvent) || 'place_both'
  const now = new Date()
  const { ymd } = asiaMontrealMins(now)
  const asiaHigh = num(payload.asiaHigh) ?? fallback?.asiaHigh
  const asiaLow = num(payload.asiaLow) ?? fallback?.asiaLow
  if (asiaHigh == null || asiaLow == null) {
    if (event === 'cancel_unfilled' || event === 'flatten') {
      if (!fallback || fallback.lockDate !== ymd) return null
      return { ...fallback, event, updatedAt: now.toISOString(), source: 'tradingview' }
    }
    return null
  }
  const asiaRange = num(payload.asiaRange) ?? asiaHigh - asiaLow
  const asiaMid = num(payload.asiaMid) ?? (asiaHigh + asiaLow) / 2
  const buyStop = num(payload.buyStop) ?? asiaHigh + recipe.buffer
  const sellStop = num(payload.sellStop) ?? asiaLow - recipe.buffer
  const longRisk = Math.abs(buyStop - asiaMid)
  const shortRisk = Math.abs(asiaMid - sellStop)
  const longTp = num(payload.longTp) ?? buyStop + 1.5 * longRisk
  const shortTp = num(payload.shortTp) ?? sellStop - 1.5 * shortRisk
  const qualified = event === 'place_both' && asiaRange > 0 && asiaRange < recipe.maxRange
  const preset = asiaPreset(instrument)
  const contracts =
    num(payload.contracts) ??
    asiaQty(Math.max(longRisk, shortRisk), preset.pointValue)
  return {
    instrument,
    lockDate: fallback?.lockDate ?? ymd,
    lockUnix: fallback?.lockUnix ?? Math.floor(now.getTime() / 1000),
    event,
    qualified,
    skipReason: qualified ? 'ok' : asiaRange > 0 ? 'range_too_wide' : 'zero_range',
    asiaHigh,
    asiaLow,
    asiaRange,
    asiaMid,
    buyStop,
    sellStop,
    longTp,
    shortTp,
    contracts: Math.max(qualified ? 1 : 0, contracts),
    contract: recipe.contract,
    maxRange: recipe.maxRange,
    buffer: recipe.buffer,
    riskCash: ASIA_ACCOUNT * (ASIA_RISK_PCT / 100),
    source: 'tradingview',
    updatedAt: now.toISOString(),
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

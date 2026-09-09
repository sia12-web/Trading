/**
 * NYC close cooldown: reprint last 5 trading days of 5m bars (fill latency gaps),
 * then recompute 5-month AVWAP, then yesterday FRVP. Overnight inventory keeps
 * updating in this snapshot until 09:30 ET cash open.
 */

import {
  compute5DayFixedRangeVolumeProfile,
  compute5MonthAnchoredVwapFromDailyBars,
  computeOvernightInventoryAndSessions,
  computeYesterdayNycSession,
  type ContextBar,
  type FixedRangeVolumeProfile5D,
  type OvernightInventoryEvaluation,
  type YesterdayNycSession,
} from '@/lib/chart/context55'
import { invalidateContext55Cache, writeContext55Cache } from '@/lib/chart/context55Cache'
import { AVWAP_CANDLE_FETCH_CALENDAR_DAYS, NY_DESK_CLOCK } from '@/lib/chart/sessionVwap'
import { getCmeDailyBars } from '@/lib/databento/cmeHistorical'
import {
  aggregateCandles,
  getDatabentoCandles,
  invalidateDatabentoCandleCache,
  isDatabentoConfigured,
  mergeCandleSeries,
  type DatabentoCandle,
} from '@/lib/databento/client'
import {
  isCloseReprintWindow,
  isOvernightInventoryWindow,
  nyYmd,
} from '@/lib/trading/deskClockPhase'
import { LIVE_DESK_NAMES, type LiveDeskName } from '@/lib/trading/systematicDesk'
import { getYahooCandles, getYahooCandlesRange } from '@/lib/yahoo/candles'
import { logger } from '@/lib/utils/logger'

export interface DeskReprintSnapshot {
  instrument: LiveDeskName
  sessionYmd: string
  reprintedAt: number
  barCount: number
  gapFillMerged: boolean
  frvp5d: FixedRangeVolumeProfile5D | null
  yesterdayNyc: YesterdayNycSession | null
  overnight: OvernightInventoryEvaluation | null
  avwap5m: ReturnType<typeof compute5MonthAnchoredVwapFromDailyBars>
  source: 'databento' | 'yahoo' | 'empty'
}

const snapshots = new Map<string, DeskReprintSnapshot>()
const reprintOnce = new Set<string>()
const lastInventoryAt = new Map<string, number>()
const INVENTORY_MS = 5 * 60 * 1000

function asBars(rows: DatabentoCandle[]): ContextBar[] {
  return rows.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))
}

async function fetchFiveMinuteBars(
  instrument: LiveDeskName,
  bypassCache: boolean
): Promise<{
  candles: DatabentoCandle[]
  source: 'databento' | 'yahoo' | 'empty'
}> {
  const days = AVWAP_CANDLE_FETCH_CALENDAR_DAYS
  let candles: DatabentoCandle[] = []
  let source: 'databento' | 'yahoo' | 'empty' = 'empty'

  if (isDatabentoConfigured()) {
    try {
      const db = await getDatabentoCandles(instrument, '5', days, { bypassCache })
      if (db?.candles?.length) {
        candles = db.candles
        source = 'databento'
      }
    } catch (err) {
      logger.warn('[desk-reprint] Databento 5m failed', { instrument, err })
    }
  }

  try {
    const yahoo = await getYahooCandles(instrument, '5', days)
    if (yahoo?.candles?.length) {
      const y = aggregateCandles(yahoo.candles, 300)
      candles = candles.length ? mergeCandleSeries(candles, y) : y
      if (source === 'empty') source = 'yahoo'
    }
  } catch (err) {
    logger.warn('[desk-reprint] Yahoo 5m stitch failed', { instrument, err })
  }

  return { candles, source }
}

async function refreshFiveMonthVwap(instrument: LiveDeskName): Promise<{
  benchmark: ReturnType<typeof compute5MonthAnchoredVwapFromDailyBars>
  dailyBars: ContextBar[]
  source: 'cme_globex' | 'yahoo_cme'
}> {
  const nowSec = Math.floor(Date.now() / 1000)
  let dailyBars = getCmeDailyBars(instrument)
  let source: 'cme_globex' | 'yahoo_cme' = 'cme_globex'
  try {
    const yahoo = await getYahooCandlesRange(instrument, 'D', nowSec - 160 * 24 * 3600, nowSec)
    if (yahoo?.candles?.length) {
      dailyBars = mergeCandleSeries(dailyBars as DatabentoCandle[], yahoo.candles as DatabentoCandle[]) as ContextBar[]
      if (!getCmeDailyBars(instrument)?.length) source = 'yahoo_cme'
    }
  } catch (err) {
    logger.warn('[desk-reprint] Yahoo daily merge failed', { instrument, err })
  }
  const benchmark = compute5MonthAnchoredVwapFromDailyBars(dailyBars, nowSec, NY_DESK_CLOCK)
  return { benchmark, dailyBars, source }
}

export function getDeskReprintSnapshot(instrument: string): DeskReprintSnapshot | null {
  return snapshots.get(instrument) ?? null
}

export async function reprintDeskInstrument(
  instrument: LiveDeskName,
  opts?: { bypassCache?: boolean }
): Promise<DeskReprintSnapshot> {
  if (opts?.bypassCache) invalidateDatabentoCandleCache(instrument)
  const { candles, source } = await fetchFiveMinuteBars(instrument, opts?.bypassCache === true)
  const bars = asBars(candles)
  const nowSec = Math.floor(Date.now() / 1000)

  const frvp5d = compute5DayFixedRangeVolumeProfile(bars, instrument, nowSec)
  const yesterdayNyc = computeYesterdayNycSession(bars, nowSec, NY_DESK_CLOCK)
  const overnight = yesterdayNyc
    ? computeOvernightInventoryAndSessions({
        bars,
        yesterday: yesterdayNyc,
        asOfUnix: nowSec,
        clock: NY_DESK_CLOCK,
      })
    : null

  const vwapPack = await refreshFiveMonthVwap(instrument)
  invalidateContext55Cache(instrument)
  if (vwapPack.benchmark) {
    const slim = vwapPack.dailyBars
      .filter((b) => b.time >= (vwapPack.benchmark!.anchorUnix ?? 0) - 86400)
      .map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }))
    writeContext55Cache(instrument, {
      benchmark: vwapPack.benchmark,
      dailyBars: slim,
      source: vwapPack.source,
      timestamp: Date.now(),
    })
  }

  const snap: DeskReprintSnapshot = {
    instrument,
    sessionYmd: nyYmd(),
    reprintedAt: Date.now(),
    barCount: bars.length,
    gapFillMerged: source === 'databento',
    frvp5d,
    yesterdayNyc,
    overnight,
    avwap5m: vwapPack.benchmark,
    source,
  }
  snapshots.set(instrument, snap)
  logger.info('desk.reprint.done', {
    instrument,
    bars: bars.length,
    yPoc: yesterdayNyc?.poc ?? null,
    onPoc: overnight?.overnight?.poc ?? null,
    vwap: vwapPack.benchmark?.vwap ?? null,
    source,
  })
  return snap
}

export async function reprintAllLiveDesks(): Promise<DeskReprintSnapshot[]> {
  const out: DeskReprintSnapshot[] = []
  for (const inst of LIVE_DESK_NAMES) {
    try {
      out.push(await reprintDeskInstrument(inst, { bypassCache: true }))
    } catch (err) {
      logger.warn('desk.reprint.instrument_failed', { instrument: inst, err })
    }
  }
  return out
}

export async function tickDeskCooldown(now: Date = new Date()): Promise<{
  phase: string
  reprinted: string[]
  inventory: string[]
}> {
  const ymd = nyYmd(now)
  const reprinted: string[] = []
  const inventory: string[] = []

  if (isCloseReprintWindow(now)) {
    const key = `reprint:${ymd}`
    if (!reprintOnce.has(key)) {
      const snaps = await reprintAllLiveDesks()
      if (snaps.length > 0) reprintOnce.add(key)
      reprinted.push(...snaps.map((s) => s.instrument))
    }
  }

  if (isOvernightInventoryWindow(now)) {
    const last = lastInventoryAt.get('all') ?? 0
    if (Date.now() - last >= INVENTORY_MS) {
      lastInventoryAt.set('all', Date.now())
      for (const inst of LIVE_DESK_NAMES) {
        try {
          await reprintDeskInstrument(inst, { bypassCache: false })
          inventory.push(inst)
        } catch (err) {
          logger.warn('desk.inventory.refresh_failed', { instrument: inst, err })
        }
      }
    }
  }

  return { phase: ymd, reprinted, inventory }
}

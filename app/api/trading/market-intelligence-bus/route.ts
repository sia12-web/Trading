import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { CANONICAL_MARKET_IDS, resolveCanonicalMarketId, type CanonicalMarketId } from '@/lib/ai/canonicalMarkets'
import {
  formatDeskBriefForInstrument,
  readMarketSnapshot,
  readMarketSnapshotHistory,
  type MarketIntelligenceSnapshot,
} from '@/lib/ai/marketIntelligenceBus'
import { formatAllMarketsDeskBriefSummary, syncFundamentalBusFromStores } from '@/lib/ai/fundamentalBusSync'
import {
  getAllWyckoffBenchmarks,
  WYCKOFF_CROSS_MARKET_BASELINE,
} from '@/lib/trading/wyckoffMarketBenchmarks'

export const dynamic = 'force-dynamic'

const AGENT_NAMES: Record<CanonicalMarketId, { agentId: string; displayName: string; uiInstrument: string }> = {
  NQ: { agentId: 'NASDAQ_AGENT', displayName: 'Nasdaq-100 Tech & Rates Specialist', uiInstrument: 'NASDAQ' },
  YM: { agentId: 'DOW_AGENT', displayName: 'Dow 30 Industrials & Credit Specialist', uiInstrument: 'DOW' },
  GC: { agentId: 'GOLD_AGENT', displayName: 'Gold Monetary & Sovereign Demand Specialist', uiInstrument: 'GOLD' },
  CL: { agentId: 'OIL_AGENT', displayName: 'WTI Crude Physical & Geopolitical Specialist', uiInstrument: 'CRUDE' },
  NK225: { agentId: 'NIKKEI_AGENT', displayName: 'Nikkei 225 BoJ & Yen FX Specialist', uiInstrument: 'NIKKEI' },
}

function readJsonSafe<T>(relPath: string, fallback: T): T {
  try {
    const abs = path.join(process.cwd(), relPath)
    if (!fs.existsSync(abs)) return fallback
    return JSON.parse(fs.readFileSync(abs, 'utf8')) as T
  } catch {
    return fallback
  }
}

function buildBusResponse(activeInstrument: string) {
  const now = new Date()
  syncFundamentalBusFromStores(now)

  const canonicalActive = resolveCanonicalMarketId(activeInstrument) || 'NQ'
  const snapshotsByMarket: Record<
    CanonicalMarketId,
    {
      agentId: string
      displayName: string
      uiInstrument: string
      snapshot: MarketIntelligenceSnapshot | null
      historyCount: number
      deskBrief: string
    }
  > = {} as any

  for (const id of CANONICAL_MARKET_IDS) {
    const meta = AGENT_NAMES[id]
    snapshotsByMarket[id] = {
      agentId: meta.agentId,
      displayName: meta.displayName,
      uiInstrument: meta.uiInstrument,
      snapshot: readMarketSnapshot(id),
      historyCount: readMarketSnapshotHistory(id).length,
      deskBrief: formatDeskBriefForInstrument(meta.uiInstrument, now),
    }
  }

  const monthlyHistory = readJsonSafe<{
    snapshots: Record<
      string,
      {
        snapshotMonth: string
        ingestedAt: string
        samplePeriod: string
        timeframe: string
        overall: Record<string, number>
      }
    >
  }>('data/wyckoff_monthly_history.json', { snapshots: {} })

  const migrationLedger = readJsonSafe<{
    projectRef?: string
    updatedAt?: string
    remoteStatus?: string
    totalMigrations?: number
    migrations?: Array<{ name: string; file: string; tablesCreated: string[]; status: string }>
  }>('data/supabase_migration_status.json', {
    totalMigrations: 18,
    remoteStatus: 'validated_staged_for_unpause',
    migrations: [],
  })

  return {
    success: true,
    timestamp: now.toISOString(),
    activeInstrument,
    canonicalActiveMarket: canonicalActive,
    activeSnapshot: snapshotsByMarket[canonicalActive],
    allMarketsSummaryText: formatAllMarketsDeskBriefSummary(now),
    desks: snapshotsByMarket,
    wyckoff: {
      baseline: WYCKOFF_CROSS_MARKET_BASELINE,
      benchmarks: getAllWyckoffBenchmarks(),
      monthlySnapshots: Object.values(monthlyHistory.snapshots || {}).sort((a, b) =>
        b.snapshotMonth.localeCompare(a.snapshotMonth)
      ),
    },
    migrations: {
      projectRef: migrationLedger.projectRef || 'zslrcnqyxoftwhxzfjrk',
      updatedAt: migrationLedger.updatedAt || now.toISOString(),
      remoteStatus: migrationLedger.remoteStatus || 'validated_staged_for_unpause',
      totalMigrations: migrationLedger.totalMigrations || 18,
      recentMigrations: (migrationLedger.migrations || []).slice(-4),
    },
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const instrument = (searchParams.get('instrument') || 'NASDAQ').toUpperCase()
  return NextResponse.json(buildBusResponse(instrument))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const instrument = String(body?.instrument || 'NASDAQ').toUpperCase()
    const snapshotMonth =
      typeof body?.month === 'string' && /^\d{4}-\d{2}$/.test(body.month)
        ? body.month
        : new Date().toISOString().slice(0, 7)

    // Ensure monthly snapshot archive is synced with the current runtime benchmark dataset
    const historyPath = path.join(process.cwd(), 'data', 'wyckoff_monthly_history.json')
    const compactDataPath = path.join(process.cwd(), 'lib', 'trading', 'wyckoffBenchmarks.data.json')
    if (fs.existsSync(compactDataPath)) {
      const benchmarkData = JSON.parse(fs.readFileSync(compactDataPath, 'utf8'))
      const historyStore = readJsonSafe<{ snapshots: Record<string, unknown> }>(
        'data/wyckoff_monthly_history.json',
        { snapshots: {} }
      )
      historyStore.snapshots[snapshotMonth] = {
        snapshotMonth,
        ingestedAt: new Date().toISOString(),
        samplePeriod: benchmarkData.metadata?.samplePeriod || 'Last 365 Days',
        timeframe: '5m',
        overall: {
          totalRangesAnalyzed: WYCKOFF_CROSS_MARKET_BASELINE.totalRangesAnalyzed,
          accumulationRanges: WYCKOFF_CROSS_MARKET_BASELINE.accumulationRanges,
          distributionRanges: WYCKOFF_CROSS_MARKET_BASELINE.distributionRanges,
          springRatePct: WYCKOFF_CROSS_MARKET_BASELINE.springRatePct,
          lpsRatePct: WYCKOFF_CROSS_MARKET_BASELINE.lpsRatePct,
          utadRatePct: WYCKOFF_CROSS_MARKET_BASELINE.utadRatePct,
          lpsyRatePct: WYCKOFF_CROSS_MARKET_BASELINE.lpsyRatePct,
          sweepDepthAvgAtr: WYCKOFF_CROSS_MARKET_BASELINE.sweepDepthAvgAtr,
          avgBreakoutAtrExpansion: WYCKOFF_CROSS_MARKET_BASELINE.avgBreakoutAtrExpansion,
          asiaFormationPct: WYCKOFF_CROSS_MARKET_BASELINE.asiaFormationPct,
          londonFormationPct: WYCKOFF_CROSS_MARKET_BASELINE.londonFormationPct,
          overnightFormationPct: WYCKOFF_CROSS_MARKET_BASELINE.overnightFormationPct,
        },
        byMarket: benchmarkData.byMarket,
      }
      fs.mkdirSync(path.dirname(historyPath), { recursive: true })
      fs.writeFileSync(historyPath, JSON.stringify(historyStore, null, 2) + '\n', 'utf8')
    }

    return NextResponse.json({
      ...buildBusResponse(instrument),
      syncedMonth: snapshotMonth,
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to sync Market Intelligence Bus' },
      { status: 500 }
    )
  }
}

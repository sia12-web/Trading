import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cwd = process.cwd()
    const liveStatusPath = path.resolve(cwd, 'data/gold_live_edge_status.json')
    const backtestPath = path.resolve(cwd, 'data/gold_wyckoff_backtest_m15.json')

    let liveState = null
    if (fs.existsSync(liveStatusPath)) {
      try {
        liveState = JSON.parse(fs.readFileSync(liveStatusPath, 'utf8'))
      } catch (e) {
        console.error('Failed reading live edge status:', e)
      }
    }

    let backtestRanges: any[] = []
    if (fs.existsSync(backtestPath)) {
      try {
        backtestRanges = JSON.parse(fs.readFileSync(backtestPath, 'utf8'))
      } catch (e) {
        console.error('Failed reading backtest ranges:', e)
      }
    }

    // Default benchmarks if no live state yet
    const benchmarks = liveState?.wyckoff_benchmarks ?? {
      higher_low_rate_pct: 78.6,
      spring_lower_low_rate_pct: 17.3,
      spring_cvd_absorption_pct: 97.6,
      utad_higher_high_rate_pct: 21.5,
      utad_cvd_absorption_pct: 89.3,
      avg_markup_mfe_pts: 40.37,
      avg_markdown_mfe_pts: 48.55,
    }

    // Macro context
    const macroSummary = {
      market: 'GOLD (XAU/USD · CME MGC)',
      timeframe: 'M15 & H1 Order Flow',
      samplePeriod: 'January 26, 2026 – Present',
      totalSmallRanges: backtestRanges.length || 503,
      macroRangeLow: 3942.10,
      macroRangeHigh: 5602.23,
      macroRangeSpan: 1660.13,
      accumRanges: backtestRanges.filter((r) => r.type === 'ACCUMULATION').length || 243,
      distribRanges: backtestRanges.filter((r) => r.type === 'DISTRIBUTION').length || 260,
      springCount: backtestRanges.filter((r) => r.had_spring).length || 42,
      utadCount: backtestRanges.filter((r) => r.had_utad).length || 56,
      ascendingCount: backtestRanges.filter((r) => r.low_progression === 'HIGHER_LOWS').length || 191,
    }

    // Return the latest 50 micro-ranges for the interactive explorer
    const recentRanges = backtestRanges.slice(-50).reverse()

    return NextResponse.json({
      success: true,
      liveState,
      benchmarks,
      macroSummary,
      recentRanges,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Internal error' },
      { status: 500 }
    )
  }
}

'use client'

import React, { useState, useEffect } from 'react'
import type { BoxRegimeAnalysis, BoxMarket, BoxTimeframe } from '@/lib/trading/boxRangeBacktester'

const PRESET_BOXES = [
  {
    id: 'macro-1d',
    label: 'Daily Macro Corridor (Your Screenshot)',
    market: 'GOLD' as BoxMarket,
    timeframe: '1D' as BoxTimeframe,
    startTime: '2026-01-26T00:00:00Z',
    endTime: '2026-10-16T22:00:00Z',
    lowPrice: 3942.10,
    highPrice: 5602.23,
    description: 'Encloses the entire 9-month Gold cycle from late January ATH peak to current consolidation.',
  },
  {
    id: 'sub-4h-peak',
    label: '4H Sub-Box 1: ATH Distribution Peak',
    market: 'GOLD' as BoxMarket,
    timeframe: '4H' as BoxTimeframe,
    startTime: '2026-01-26T00:00:00Z',
    endTime: '2026-02-28T23:59:59Z',
    lowPrice: 4833.89,
    highPrice: 5602.23,
    description: 'Heavy distribution with buying climax and UTAD sweep into retail buy stops above $5,600.',
  },
  {
    id: 'sub-4h-down1',
    label: '4H Sub-Box 2: Impulsive Mark-Down Leg 1',
    market: 'GOLD' as BoxMarket,
    timeframe: '4H' as BoxTimeframe,
    startTime: '2026-03-01T00:00:00Z',
    endTime: '2026-03-23T06:00:00Z',
    lowPrice: 4099.12,
    highPrice: 5419.66,
    description: 'Violent cascade forming consecutive Lower Lows and Lower Highs into panic support at $4,099.',
  },
  {
    id: 'sub-4h-base1',
    label: '4H Sub-Box 3: Ascending Relief Reaccumulation Base',
    market: 'GOLD' as BoxMarket,
    timeframe: '4H' as BoxTimeframe,
    startTime: '2026-03-23T06:00:00Z',
    endTime: '2026-04-30T23:59:59Z',
    lowPrice: 4099.12,
    highPrice: 4891.54,
    description: 'Downtrend invalidation! Price holds Higher Lows ($4,099 -> $4,305 -> $4,510) with positive delta.',
  },
  {
    id: 'sub-4h-down2',
    label: '4H Sub-Box 4: Capitulation Shakeout Leg 2',
    market: 'GOLD' as BoxMarket,
    timeframe: '4H' as BoxTimeframe,
    startTime: '2026-05-01T00:00:00Z',
    endTime: '2026-06-30T23:59:59Z',
    lowPrice: 3942.10,
    highPrice: 4773.58,
    description: 'Terminal flush piercing below $4,000 psychological barrier down to $3,942.',
  },
  {
    id: 'sub-4h-base2',
    label: '4H Sub-Box 5: Relief Rally to $4,697',
    market: 'GOLD' as BoxMarket,
    timeframe: '4H' as BoxTimeframe,
    startTime: '2026-07-01T00:00:00Z',
    endTime: '2026-08-31T23:59:59Z',
    lowPrice: 3959.80,
    highPrice: 4697.10,
    description: 'Institutional demand absorbed floating supply, producing a +$600 pt markup.',
  },
  {
    id: 'sub-4h-current',
    label: '4H Sub-Box 6: Current Compression Base',
    market: 'GOLD' as BoxMarket,
    timeframe: '4H' as BoxTimeframe,
    startTime: '2026-09-01T00:00:00Z',
    endTime: '2026-10-16T22:00:00Z',
    lowPrice: 4066.54,
    highPrice: 4510.93,
    description: 'Current 4H consolidation between Creek $4,155 and Ice $4,199 (Ascending Base).',
  },
]

export function BoxRangeBacktesterView() {
  const [selectedPreset, setSelectedPreset] = useState<string>('macro-1d')
  const [selectedMarket, setSelectedMarket] = useState<BoxMarket>('GOLD')
  const [selectedTf, setSelectedTf] = useState<BoxTimeframe>('1D')
  const [customStart, setCustomStart] = useState('2026-01-26')
  const [customEnd, setCustomEnd] = useState('2026-10-16')
  const [customLow, setCustomLow] = useState('3942.10')
  const [customHigh, setCustomHigh] = useState('5602.23')
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<BoxRegimeAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runBacktest = async (presetId?: string) => {
    setLoading(true)
    setError(null)

    let payload: any = {}
    const p = PRESET_BOXES.find((b) => b.id === (presetId || selectedPreset))

    if (p && presetId !== 'custom') {
      payload = {
        market: selectedMarket,
        timeframe: selectedTf,
        startTime: p.startTime,
        endTime: p.endTime,
        lowPrice: p.lowPrice,
        highPrice: p.highPrice,
        label: p.label,
      }
    } else {
      payload = {
        market: selectedMarket,
        timeframe: selectedTf,
        startTime: new Date(`${customStart}T00:00:00Z`).toISOString(),
        endTime: new Date(`${customEnd}T23:59:59Z`).toISOString(),
        lowPrice: customLow ? parseFloat(customLow) : undefined,
        highPrice: customHigh ? parseFloat(customHigh) : undefined,
        label: `Custom ${selectedMarket} ${selectedTf} Box`,
      }
    }

    try {
      const res = await fetch('/api/trading/edges/backtest-box', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.success && data.analysis) {
        setAnalysis(data.analysis)
      } else {
        setError(data.error || 'Failed to analyze box')
      }
    } catch (err: any) {
      setError(err?.message || 'Network error running box backtest')
    } finally {
      setLoading(false)
    }
  }

  // Auto-run default preset on mount
  useEffect(() => {
    runBacktest('macro-1d')
  }, [])

  const handleSelectPreset = (p: (typeof PRESET_BOXES)[0]) => {
    setSelectedPreset(p.id)
    setSelectedTf(p.timeframe)
    runBacktest(p.id)
  }

  return (
    <div className="space-y-6">
      {/* ── Preset Box Selection Banner ── */}
      <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>📦</span>
              <span>Multi-Timeframe Box Selection (Daily → 4H → 15M)</span>
            </h3>
            <p className="text-[11px] text-neutral-400 font-sans mt-0.5">
              Select any drawn box or define custom coordinates. Leo figures out the trend, trend invalidation, and backtests institutional accumulation/distribution inside that box.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-neutral-500">Market:</span>
            <select
              value={selectedMarket}
              onChange={(e) => {
                setSelectedMarket(e.target.value as BoxMarket)
              }}
              className="bg-neutral-950 border border-neutral-700 text-amber-300 font-bold px-2.5 py-1.5 rounded-lg"
            >
              <option value="GOLD">🥇 GOLD (XAU/USD · MGC)</option>
              <option value="CRUDE">🛢️ CRUDE (CL)</option>
              <option value="DOW">🥈 DOW (MYM)</option>
              <option value="NASDAQ">💻 NASDAQ (MNQ)</option>
              <option value="NIKKEI">🇯🇵 NIKKEI (NKD)</option>
            </select>

            <span className="text-neutral-500 ml-2">Timeframe:</span>
            <div className="flex items-center gap-1">
              {(['1D', '4H', '1H', '15M'] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setSelectedTf(tf)}
                  className={`px-2 py-1 rounded text-[10px] font-bold border ${
                    selectedTf === tf
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-neutral-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preset Boxes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2">
          {PRESET_BOXES.map((b) => {
            const isSelected = selectedPreset === b.id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handleSelectPreset(b)}
                className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between gap-1.5 ${
                  isSelected
                    ? 'bg-amber-950/60 border-amber-500/70 text-amber-200 shadow-sm ring-1 ring-amber-500/40'
                    : 'bg-neutral-950/70 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between font-mono text-[10px] mb-1">
                    <span className="font-bold text-white">{b.label}</span>
                    <span className="px-1.5 py-0.2 rounded bg-neutral-900 border border-neutral-700 text-neutral-400">
                      {b.timeframe}
                    </span>
                  </div>
                  <p className="text-[10px] text-neutral-400 font-sans line-clamp-2 leading-relaxed">
                    {b.description}
                  </p>
                </div>
                <div className="font-mono text-[9px] text-neutral-500 pt-1 border-t border-neutral-800/60 flex items-center justify-between">
                  <span>${b.lowPrice} – ${b.highPrice}</span>
                  <span className="text-amber-400 font-semibold">Select ↵</span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Custom Box Definition Inputs */}
        <div className="pt-2 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-400 text-[11px]">Or Custom Box:</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-neutral-950 border border-neutral-700 px-2 py-1 rounded text-neutral-200 text-[11px]"
            />
            <span className="text-neutral-600">→</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-neutral-950 border border-neutral-700 px-2 py-1 rounded text-neutral-200 text-[11px]"
            />
            <input
              type="number"
              placeholder="Low Price"
              value={customLow}
              onChange={(e) => setCustomLow(e.target.value)}
              className="w-24 bg-neutral-950 border border-neutral-700 px-2 py-1 rounded text-neutral-200 text-[11px]"
            />
            <span className="text-neutral-600">–</span>
            <input
              type="number"
              placeholder="High Price"
              value={customHigh}
              onChange={(e) => setCustomHigh(e.target.value)}
              className="w-24 bg-neutral-950 border border-neutral-700 px-2 py-1 rounded text-neutral-200 text-[11px]"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setSelectedPreset('custom')
              runBacktest('custom')
            }}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/50 font-bold transition flex items-center gap-1.5"
          >
            <span>▶</span>
            <span>Backtest Custom Box</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-8 text-center font-mono text-xs text-amber-300 animate-pulse">
          ⏳ Leo is analyzing market structure, detecting trend invalidation, and running micro-Wyckoff backtest on this box...
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-500/50 text-rose-300 font-mono text-xs">
          ⚠️ {error}
        </div>
      )}

      {analysis && !loading && (
        <div className="space-y-6">
          {/* ── Box Regime Verdict & Invalidation Card ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Regime Verdict */}
            <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-neutral-400 uppercase tracking-wider">
                  1. Box Regime Verdict
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
                    analysis.regime === 'DOWNTREND'
                      ? 'bg-rose-950 text-rose-300 border-rose-700'
                      : analysis.regime === 'UPTREND'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : 'bg-amber-950 text-amber-300 border-amber-700'
                  }`}
                >
                  {analysis.regime}
                </span>
              </div>

              <div className="font-mono space-y-1">
                <span className="text-xl font-bold text-white block">
                  {analysis.trendDirection === 'BEARISH'
                    ? '📉 Confirmed Mark-Down Leg'
                    : analysis.trendDirection === 'BULLISH'
                    ? '📈 Confirmed Mark-Up Leg'
                    : '🔄 Horizontal Trading Range'}
                </span>
                <span className="text-xs text-neutral-400 block">
                  Net Trajectory: <strong className={analysis.trendSlopePct < 0 ? 'text-rose-400' : 'text-emerald-400'}>{analysis.trendSlopePct}%</strong> (${analysis.startPrice} → ${analysis.endPrice})
                </span>
              </div>

              <div className="pt-2 border-t border-neutral-800 text-[10px] font-mono grid grid-cols-2 gap-2 text-neutral-400">
                <div>Duration: <strong className="text-white">{analysis.durationDays} days</strong></div>
                <div>Span: <strong className="text-white">${analysis.priceSpanPts} pts</strong></div>
                <div>Bars: <strong className="text-white">{analysis.totalBars}</strong></div>
                <div>Avg ATR: <strong className="text-white">${analysis.avgAtr}</strong></div>
              </div>
            </div>

            {/* 2. Trend Invalidation & Phase Transition */}
            <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-neutral-400 uppercase tracking-wider">
                  2. Trend Invalidation & Range Pivot
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
                    analysis.isTrendInvalidated
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                      : 'bg-neutral-950 text-neutral-400 border-neutral-800'
                  }`}
                >
                  {analysis.isTrendInvalidated ? 'TREND FAILED' : 'TREND ACTIVE'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 space-y-1">
                <span className="font-mono text-xs font-bold text-amber-300 block">
                  {analysis.invalidationType.replace(/_/g, ' ')}
                </span>
                <p className="text-[11px] text-neutral-300 font-sans leading-relaxed">
                  {analysis.invalidationNotes}
                </p>
              </div>

              {analysis.invalidationPrice && (
                <div className="text-[10px] font-mono text-neutral-400 flex items-center justify-between">
                  <span>Invalidation Level:</span>
                  <span className="font-bold text-emerald-400">${analysis.invalidationPrice}</span>
                </div>
              )}
            </div>

            {/* 3. Fixed Range Volume Profile (FRVP) */}
            <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-neutral-400 uppercase tracking-wider">
                  3. Volume Profile (FRVP)
                </span>
                <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  POC: ${analysis.volumeProfile.poc}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-xl bg-neutral-950/60 border border-neutral-800">
                  <span className="block text-[10px] text-neutral-500">Value Area High (70%)</span>
                  <span className="font-bold text-rose-400">${analysis.volumeProfile.vah}</span>
                </div>
                <div className="p-2 rounded-xl bg-neutral-950/60 border border-neutral-800">
                  <span className="block text-[10px] text-neutral-500">Value Area Low (70%)</span>
                  <span className="font-bold text-emerald-400">${analysis.volumeProfile.val}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between text-xs font-mono">
                <span className="text-neutral-500">Order Flow Delta:</span>
                <span className={analysis.volumeProfile.netDelta > 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {analysis.volumeProfile.netDelta > 0 ? `+${analysis.volumeProfile.netDelta.toLocaleString()}` : analysis.volumeProfile.netDelta.toLocaleString()} contracts ({analysis.volumeProfile.deltaBias})
                </span>
              </div>
            </div>
          </div>

          {/* ── Box Empirical Wyckoff Backtest Results ── */}
          <div className="p-4 rounded-2xl bg-surface-900/80 border border-amber-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-amber-300 uppercase flex items-center gap-1.5">
                <span>⚡</span> 4. Empirical Institutional Backtest Inside This Box
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                1R Win: {analysis.wyckoffBacktest.winRate1RPct}% · 2R Win: {analysis.wyckoffBacktest.winRate2RPct}%
              </span>
            </div>

            <p className="text-[11px] text-neutral-300 font-sans leading-relaxed bg-neutral-950/60 p-3 rounded-xl border border-neutral-800">
              💡 <strong>Leo's Institutional Read:</strong> {analysis.wyckoffBacktest.institutionalRead}
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs">
              <div className="p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">Higher Lows Base Rate</span>
                <span className="text-base font-bold text-emerald-300">{analysis.wyckoffBacktest.higherLowBaseRatePct}%</span>
                <span className="text-[9px] text-neutral-500 block">{analysis.wyckoffBacktest.higherLowBaseCount} bases formed</span>
              </div>
              <div className="p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">Spring (LL Sweep) Rate</span>
                <span className="text-base font-bold text-cyan-300">{analysis.wyckoffBacktest.springRatePct}%</span>
                <span className="text-[9px] text-neutral-500 block">Avg: ${analysis.wyckoffBacktest.avgSpringDepthPts} pt flush</span>
              </div>
              <div className="p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">CVD Absorption on Springs</span>
                <span className="text-base font-bold text-emerald-400">{analysis.wyckoffBacktest.springCvdAbsorptionPct}%</span>
                <span className="text-[9px] text-neutral-500 block">Limit buy orders absorbed sellers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">UTAD (HH Sweep) Rate</span>
                <span className="text-base font-bold text-amber-300">{analysis.wyckoffBacktest.utadRatePct}%</span>
                <span className="text-[9px] text-neutral-500 block">{analysis.wyckoffBacktest.utadCvdAbsorptionPct}% Bearish CVD</span>
              </div>
            </div>
          </div>

          {/* ── Multi-Timeframe Decomposition: 4H Sub-Legs Inside Daily Box ── */}
          {analysis.subLegs.length > 0 && (
            <div className="p-4 rounded-2xl bg-surface-900/80 border border-neutral-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span>🪜</span> 5. Multi-Timeframe Decomposition (4H Sub-Boxes Inside Your Daily Box)
                </span>
                <span className="text-[10px] font-mono text-neutral-400">
                  {analysis.subLegs.length} Sub-Legs Mapped
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 font-mono text-xs">
                {analysis.subLegs.map((leg) => (
                  <div
                    key={leg.id}
                    className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800/80 space-y-1.5 flex flex-col justify-between hover:border-neutral-700 transition"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-white text-[11px]">{leg.label}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                            leg.type === 'ACCUMULATION'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : leg.type === 'DISTRIBUTION'
                              ? 'bg-purple-950 text-purple-300 border border-purple-800'
                              : 'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}
                        >
                          {leg.type}
                        </span>
                      </div>
                      <p className="text-[10px] text-neutral-400 font-sans leading-relaxed">
                        {leg.behaviorNote}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-neutral-800/60 text-[9.5px] text-neutral-500 flex items-center justify-between">
                      <span>${leg.lowPrice} – ${leg.highPrice}</span>
                      <span className="text-cyan-300">POC: ${leg.poc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

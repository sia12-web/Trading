'use client'

/**
 * Cross-Market Volatility & 5-Market Opportunity Radar Strip
 *
 * Renders:
 * 1. Dedicated Cboe Volatility Gauges: VIX1D (Equities), OVX (Crude), GVZ (Gold).
 * 2. 5-Market Opportunity Radar: NQ, YM, ES, GC, CL scored on Participation x Location x Structure.
 * 3. Quick-switch instrument triggers & Grade A Top-Pick spotlight.
 */

import React, { useState, useEffect } from 'react'
import type { CrossMarketVolatilityState } from '@/lib/trading/crossMarketVolatility'
import type {
  CrossMarketRadarReport,
  MarketOpportunityCard,
  RadarMarket,
} from '@/lib/trading/crossMarketRadar'

export interface GlobexSessionStatus {
  isOpen: boolean
  sessionName: 'ASIA' | 'LONDON' | 'NEW_YORK' | 'CLOSED'
  statusBadge: string
  subText: string
  etTimeStr: string
}

export function getGlobexSessionStatus(): GlobexSessionStatus {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })

  const parts = formatter.formatToParts(now)
  let weekday = 'Sun'
  let hour = 0
  let minute = 0

  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value
    if (part.type === 'hour') hour = parseInt(part.value, 10)
    if (part.type === 'minute') minute = parseInt(part.value, 10)
  }

  const totalMinutes = hour * 60 + minute
  const etTimeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`

  // Weekend Close: Friday 17:00 ET through Sunday 18:00 ET
  if (weekday === 'Fri' && hour >= 17) {
    return {
      isOpen: false,
      sessionName: 'CLOSED',
      statusBadge: '🌙 MARKET CLOSED',
      subText: 'Weekend Close · Resumes Sun 18:00 ET',
      etTimeStr,
    }
  }
  if (weekday === 'Sat') {
    return {
      isOpen: false,
      sessionName: 'CLOSED',
      statusBadge: '🌙 MARKET CLOSED',
      subText: 'Weekend Close · Resumes Sun 18:00 ET',
      etTimeStr,
    }
  }
  if (weekday === 'Sun' && hour < 18) {
    return {
      isOpen: false,
      sessionName: 'CLOSED',
      statusBadge: '🌙 MARKET CLOSED',
      subText: 'Weekend Close · Resumes 18:00 ET (Asia Open)',
      etTimeStr,
    }
  }

  // Daily Settlement Halt: Monday through Thursday 17:00 to 18:00 ET
  if (['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday) && hour >= 17 && hour < 18) {
    return {
      isOpen: false,
      sessionName: 'CLOSED',
      statusBadge: '⏸️ DAILY HALT',
      subText: 'CME Settlement · Resumes 18:00 ET',
      etTimeStr,
    }
  }

  // Active Globex Sessions:
  // Asia Session: 18:00 to 03:00 ET
  if (hour >= 18 || hour < 3) {
    return {
      isOpen: true,
      sessionName: 'ASIA',
      statusBadge: '🟢 ASIA LIVE',
      subText: 'Asia / Tokyo Session (18:00 - 03:00 ET)',
      etTimeStr,
    }
  }

  // London Session: 03:00 to 09:30 ET
  if (hour >= 3 && totalMinutes < 9 * 60 + 30) {
    return {
      isOpen: true,
      sessionName: 'LONDON',
      statusBadge: '🟢 LONDON LIVE',
      subText: 'London / European Session (03:00 - 09:30 ET)',
      etTimeStr,
    }
  }

  // New York Session: 09:30 to 17:00 ET
  return {
    isOpen: true,
    sessionName: 'NEW_YORK',
    statusBadge: '🟢 NY REGULAR LIVE',
    subText: 'US Cash Session (09:30 - 17:00 ET)',
    etTimeStr,
  }
}

interface CrossMarketRadarStripProps {
  currentInstrument: string
  onSelectInstrument?: (instrument: string) => void
  onAskLeo?: (prompt: string) => void
}

export function CrossMarketRadarStrip({
  currentInstrument,
  onSelectInstrument,
  onAskLeo,
}: CrossMarketRadarStripProps) {
  const [volatility, setVolatility] = useState<CrossMarketVolatilityState | null>(null)
  const [radar, setRadar] = useState<CrossMarketRadarReport | null>(null)
  const [selectedCard, setSelectedCard] = useState<MarketOpportunityCard | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionStatus, setSessionStatus] = useState<GlobexSessionStatus>(getGlobexSessionStatus)

  useEffect(() => {
    let isMounted = true

    async function fetchRadarData() {
      try {
        const res = await fetch('/api/trading/cross-market-volatility')
        if (!res.ok) return
        const data = await res.json()
        if (isMounted && data.success) {
          setVolatility(data.volatility)
          setRadar(data.radar)
        }
      } catch {
        // Fallback silently if offline
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchRadarData()
    const timer = setInterval(fetchRadarData, 30_000)
    const sessionTimer = setInterval(() => {
      setSessionStatus(getGlobexSessionStatus())
    }, 10_000)

    return () => {
      isMounted = false
      clearInterval(timer)
      clearInterval(sessionTimer)
    }
  }, [])

  if (isLoading && !radar) {
    return (
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-950/80 border-b border-surface-800 text-[10px] text-gray-400 font-mono">
        <span className="animate-pulse">Loading Cross-Asset Volatility Radar (VIX1D · OVX · GVZ)…</span>
      </div>
    )
  }

  const vol = volatility
  const markets = radar?.markets ? Object.values(radar.markets) : []

  return (
    <div className="relative border-b border-surface-800 bg-surface-950/90 text-xs select-none backdrop-blur-sm">
      <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        {/* Left: Volatility Gauges */}
        <div className="flex items-center gap-2 overflow-x-auto text-[11px] font-mono shrink-0">
          <div className="flex items-center gap-1.5 text-gray-400 font-bold uppercase tracking-wider text-[9px] mr-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>Vol Gauges:</span>
          </div>

          {/* VIX1D (Equities) */}
          <div
            className={`px-2 py-0.5 rounded border flex items-center gap-1.5 ${
              vol?.equities.isExpanding
                ? 'border-red-500/50 bg-red-950/40 text-red-300'
                : 'border-surface-700 bg-surface-900/60 text-gray-300'
            }`}
            title="VIX1D: 1-Day Intraday Expected Equity Volatility (SPX 0DTE/1DTE)"
          >
            <span className="text-[9px] text-gray-400">EQ (VIX1D):</span>
            <span className="font-bold">{vol ? vol.equities.vix1d.value.toFixed(1) : '—'}</span>
            {vol?.equities.isExpanding && (
              <span className="text-[9px] text-red-400 font-extrabold animate-pulse">EXPANDING 🔥</span>
            )}
          </div>

          {/* OVX (Crude Oil) */}
          <div
            className={`px-2 py-0.5 rounded border flex items-center gap-1.5 ${
              vol?.crude.isExpanding
                ? 'border-amber-500/50 bg-amber-950/40 text-amber-200'
                : 'border-surface-700 bg-surface-900/60 text-gray-300'
            }`}
            title="OVX: Cboe Crude Oil Volatility Index (USO options)"
          >
            <span className="text-[9px] text-gray-400">OIL (OVX):</span>
            <span className="font-bold">{vol ? vol.crude.ovx.value.toFixed(1) : '—'}</span>
            {vol?.crude.isExpanding && (
              <span className="text-[9px] text-amber-400 font-extrabold animate-pulse">EXPANDING 🔥</span>
            )}
          </div>

          {/* JNIV (Nikkei 225) */}
          <div
            className={`px-2 py-0.5 rounded border flex items-center gap-1.5 ${
              vol?.nikkei?.isExpanding
                ? 'border-fuchsia-500/50 bg-fuchsia-950/40 text-fuchsia-200'
                : 'border-surface-700 bg-surface-900/60 text-gray-300'
            }`}
            title={vol?.nikkei?.jniv.description ?? 'Nikkei volatility'}
          >
            <span className="text-[9px] text-gray-400">
              NIKKEI ({vol?.nikkei?.jniv.name.toLowerCase().includes('realized') ? 'RV' : 'JNIV'}):
            </span>
            <span className="font-bold">{vol?.nikkei ? vol.nikkei.jniv.value.toFixed(1) : '—'}</span>
            {vol?.nikkei?.isExpanding && (
              <span className="text-[9px] text-fuchsia-400 font-extrabold animate-pulse">EXPANDING 🔥</span>
            )}
          </div>

          {/* GVZ (Gold) */}
          <div
            className={`px-2 py-0.5 rounded border flex items-center gap-1.5 ${
              vol?.gold.isExpanding
                ? 'border-yellow-500/50 bg-yellow-950/40 text-yellow-200'
                : 'border-surface-700 bg-surface-900/60 text-gray-300'
            }`}
            title="GVZ: Cboe Gold Volatility Index (GLD options)"
          >
            <span className="text-[9px] text-gray-400">GOLD (GVZ):</span>
            <span className="font-bold">{vol ? vol.gold.gvz.value.toFixed(1) : '—'}</span>
            {vol?.gold.isExpanding && (
              <span className="text-[9px] text-yellow-400 font-extrabold animate-pulse">EXPANDING 🔥</span>
            )}
          </div>
        </div>

        {/* Center: Globex Session Status Indicator */}
        <div
          className={`px-2.5 py-0.5 rounded border text-[10.5px] font-mono flex items-center gap-1.5 shrink-0 transition-all ${
            sessionStatus.isOpen
              ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300'
              : 'border-amber-600/50 bg-amber-950/50 text-amber-300'
          }`}
          title={`${sessionStatus.subText} · ${sessionStatus.etTimeStr}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              sessionStatus.isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
          <span className="font-extrabold">{sessionStatus.statusBadge}</span>
          <span className="text-[9.5px] text-gray-400 hidden xl:inline">
            ({sessionStatus.subText})
          </span>
        </div>

        {/* Right: 5-Market Opportunity Radar */}
        <div className="flex items-center gap-1.5 overflow-x-auto font-mono">
          <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold mr-1">
            Cross-Market Radar:
          </span>

          {markets.map((m) => {
            const isCurrent =
              (m.market === 'NASDAQ' && (currentInstrument === 'NASDAQ' || currentInstrument === 'NQ')) ||
              (m.market === 'DOW' && (currentInstrument === 'DOW' || currentInstrument === 'YM')) ||
              (m.market === 'SP500' && (currentInstrument === 'SP500' || currentInstrument === 'ES')) ||
              (m.market === 'GOLD' && (currentInstrument === 'GOLD' || currentInstrument === 'GC')) ||
              (m.market === 'CRUDE' && (currentInstrument === 'CRUDE' || currentInstrument === 'CL')) ||
              (m.market === 'NIKKEI' && (currentInstrument === 'NIKKEI' || currentInstrument === 'NKD'))

            const isGradeA = m.grade === 'A'
            const isGradeB = m.grade === 'B'

            const badgeBg = isGradeA
              ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200 hover:bg-emerald-900/80 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
              : isGradeB
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-200 hover:bg-amber-900/60'
              : 'bg-surface-900/60 border-surface-700/60 text-gray-400 hover:bg-surface-800'

            return (
              <button
                key={m.market}
                type="button"
                onClick={() => {
                  setSelectedCard(m)
                  if (onSelectInstrument) {
                    const instMap: Record<RadarMarket, string> = {
                      NASDAQ: 'NASDAQ',
                      DOW: 'DOW',
                      SP500: 'NASDAQ', // route to desk instrument if S&P not separate chart tab
                      GOLD: 'GOLD',
                      CRUDE: 'CRUDE',
                      NIKKEI: 'NIKKEI',
                    }
                    onSelectInstrument(instMap[m.market])
                  }
                }}
                className={`relative px-2 py-0.5 rounded text-[10.5px] border flex items-center gap-1 transition ${badgeBg} ${
                  isCurrent ? 'ring-1 ring-white/60' : ''
                }`}
                title={
                  !sessionStatus.isOpen
                    ? `[OFF-SESSION · Prior Friday Close] Click to inspect ${m.contractLabel} (${m.summaryLine})`
                    : `Click to inspect ${m.contractLabel} (${m.summaryLine})`
                }
              >
                {m.isTopPick && (
                  <span className="text-[9px] text-amber-300 font-extrabold animate-bounce">★</span>
                )}
                <span className="font-bold text-white">{m.tickerRoot}</span>
                <span className={m.dayChangePct >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                  {m.dayChangePct >= 0 ? '+' : ''}
                  {m.dayChangePct.toFixed(1)}%
                </span>
                <span
                  className={`text-[9px] font-extrabold px-1 rounded ${
                    isGradeA
                      ? 'bg-emerald-500/30 text-emerald-300'
                      : isGradeB
                      ? 'bg-amber-500/30 text-amber-300'
                      : 'bg-surface-700 text-gray-400'
                  }`}
                >
                  {m.grade}
                </span>

                {/* 3 Pillar indicators: P L S */}
                <span className="flex items-center gap-0.5 text-[8px] tracking-tighter opacity-80">
                  <span className={m.participation.present ? 'text-emerald-400' : 'text-gray-600'}>
                    P
                  </span>
                  <span className={m.location.present ? 'text-emerald-400' : 'text-gray-600'}>
                    L
                  </span>
                  <span className={m.structure.present ? 'text-emerald-400' : 'text-gray-600'}>
                    S
                  </span>
                </span>
              </button>
            )
          })}

          {/* Quick Ask Leo Button */}
          {onAskLeo && (
            <button
              type="button"
              onClick={() =>
                onAskLeo(
                  'Leo, rank the 5 markets (Nasdaq, Dow, S&P, Gold, Oil) using cross-asset volatility (VIX1D, OVX, GVZ) and the Participation x Location x Structure matrix. Tell me which market is Grade A today.'
                )
              }
              className="px-2 py-0.5 ml-1 rounded bg-indigo-950/60 hover:bg-indigo-900 border border-indigo-500/40 text-[10px] text-indigo-200 font-bold shrink-0 transition"
              title="Ask Leo for live 5-market radar ranking"
            >
              🤖 Radar
            </button>
          )}
        </div>
      </div>

      {/* Detail Popover Drawer */}
      {selectedCard && (
        <div className="px-3 py-2 border-t border-surface-800 bg-surface-900/95 flex flex-col md:flex-row md:items-center justify-between gap-2 text-[11px] animate-fadeIn">
          <div className="flex-1 space-y-1.5">
            {!sessionStatus.isOpen && (
              <div className="px-2.5 py-1 bg-amber-950/40 border border-amber-500/40 rounded text-[10.5px] text-amber-200 flex items-center gap-2">
                <span className="text-sm shrink-0">🌙</span>
                <span className="leading-tight">
                  <strong className="text-amber-300">Market is Currently Closed ({sessionStatus.subText}).</strong>{' '}
                  <span className="text-gray-300">
                    Grade and metrics shown reflect Friday&apos;s close. Live participation and real-time triggers will activate when the Globex session opens (Sun 18:00 ET Asia / Mon 03:00 ET London / 09:30 ET NY).
                  </span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-white text-xs">
                {selectedCard.contractLabel}
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold ${
                  selectedCard.grade === 'A'
                    ? 'bg-emerald-500/30 text-emerald-300'
                    : selectedCard.grade === 'B'
                    ? 'bg-amber-500/30 text-amber-300'
                    : 'bg-surface-700 text-gray-400'
                }`}
              >
                GRADE {selectedCard.grade} ({selectedCard.verdict.replace(/_/g, ' ')})
              </span>
              <span className="text-[10px] text-gray-400 font-mono">
                {selectedCard.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} (
                {selectedCard.dayChangePct >= 0 ? '+' : ''}
                {selectedCard.dayChangePct.toFixed(2)}%) · {selectedCard.volatilityGauge}:{' '}
                {selectedCard.volatilityValue.toFixed(1)} ({selectedCard.volatilityRegime})
              </span>
            </div>
            <p className="text-gray-300 text-[11px] leading-snug">
              {selectedCard.summaryLine}
            </p>
            <div className="flex flex-wrap gap-3 text-[10px] text-gray-400 font-mono pt-0.5">
              <span>
                • <strong>Participation:</strong>{' '}
                <span className={selectedCard.participation.present ? 'text-emerald-400' : 'text-gray-500'}>
                  {selectedCard.participation.headline}
                </span>
              </span>
              <span>
                • <strong>Location:</strong>{' '}
                <span className={selectedCard.location.present ? 'text-emerald-400' : 'text-gray-500'}>
                  {selectedCard.location.headline}
                </span>
              </span>
              <span>
                • <strong>Structure:</strong>{' '}
                <span className={selectedCard.structure.present ? 'text-emerald-400' : 'text-gray-500'}>
                  {selectedCard.structure.headline}
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onAskLeo && (
              <button
                type="button"
                onClick={() =>
                  onAskLeo(
                    `Leo, give me the detailed breakdown for ${selectedCard.contractLabel}. Explain its Participation (${selectedCard.volatilityGauge}), Location, and Structure.`
                  )
                }
                className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] text-amber-200 font-bold transition"
              >
                Ask Leo About {selectedCard.tickerRoot}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedCard(null)}
              className="text-gray-400 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

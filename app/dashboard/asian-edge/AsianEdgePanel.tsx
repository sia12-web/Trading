'use client'

import React, { useState, useEffect } from 'react'
import {
  ASIAN_EDGE_CONFIGS,
  evaluateAsianEdgeStatus,
  getEasternTime,
  type AsianEdgeStatus,
} from '@/lib/trading/asianEdgeEngine'

interface AsianEdgePanelProps {
  instrument: string
  currentPrice?: number
  candles?: Array<{ open: number; high: number; low: number; close: number; time: number }>
  onAskLeo: (prompt: string) => void
}

export function AsianEdgePanel({
  instrument,
  currentPrice,
  candles = [],
  onAskLeo,
}: AsianEdgePanelProps) {
  const [selectedInst, setSelectedInst] = useState<string>(() => {
    const norm = instrument.toUpperCase()
    if (norm.includes('GOLD') || norm.includes('MGC')) return 'GOLD'
    if (norm.includes('DOW') || norm.includes('YM')) return 'DOW'
    if (norm.includes('NAS') || norm.includes('NQ')) return 'NASDAQ'
    if (norm.includes('NIKKEI') || norm.includes('NKD') || norm.includes('JP225')) return 'NIKKEI'
    if (norm.includes('OIL') || norm.includes('CL')) return 'OIL'
    return 'GOLD'
  })

  const [currentTimeStr, setCurrentTimeStr] = useState<string>('')
  const [telegramStatus, setTelegramStatus] = useState<{
    loading: boolean
    success?: boolean
    message?: string
    isChatNotFound?: boolean
  }>({ loading: false })

  // Keep live time ticking every 10 seconds
  useEffect(() => {
    const updateTime = () => {
      const { timeStr } = getEasternTime()
      setCurrentTimeStr(timeStr)
    }
    updateTime()
    const timer = setInterval(updateTime, 10000)
    return () => clearInterval(timer)
  }, [])

  const status: AsianEdgeStatus = evaluateAsianEdgeStatus(
    selectedInst,
    candles,
    currentPrice
  )

  const handleTestTelegram = async () => {
    setTelegramStatus({ loading: true })
    try {
      const res = await fetch('/api/trading/asian-edge/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: selectedInst }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setTelegramStatus({
          loading: false,
          success: true,
          message: '✅ Telegram alert sent! Check your Telegram app.',
        })
      } else {
        setTelegramStatus({
          loading: false,
          success: false,
          message: data.instructions || data.error || 'Failed to send alert',
          isChatNotFound: data.isChatNotFound,
        })
      }
    } catch (err: any) {
      setTelegramStatus({
        loading: false,
        success: false,
        message: err?.message || 'Network error reaching Telegram API',
      })
    }
  }

  const phaseColor =
    status.phase === 'EXECUTION_WINDOW'
      ? 'border-emerald-500 bg-emerald-950/80 text-emerald-300'
      : status.phase === 'OUTING_FLATTEN'
      ? 'border-red-500 bg-red-950/80 text-red-300'
      : status.phase === 'BOX_COMPRESSION'
      ? 'border-amber-500/70 bg-amber-950/70 text-amber-300'
      : 'border-purple-500/50 bg-surface-900 text-purple-300'

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs flex flex-col min-h-0 select-text">
      {/* ── Main Banner ── */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-neutral-900 via-amber-950/40 to-neutral-900 border border-amber-500/40 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌙</span>
            <div>
              <h3 className="text-xs font-mono font-bold text-white tracking-wide flex items-center gap-1.5">
                Asian Edge Institutional Desk
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                  6-Mo Backtested
                </span>
              </h3>
              <p className="text-[10.5px] text-neutral-300 font-mono">
                Execution, Outing & Risk Brackets (Gold, Dow, Nasdaq)
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono font-bold text-neutral-200 bg-neutral-950/90 px-2 py-1 rounded border border-neutral-700">
            {currentTimeStr || '18:00 ET'}
          </span>
        </div>

        {/* Live Phase & Countdown Pill */}
        <div className={`p-2 rounded-lg border flex items-center justify-between ${phaseColor}`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
            <span className="font-mono font-bold text-[11px]">{status.phaseLabel}</span>
          </div>
          <div className="font-mono text-[10px] text-right">
            <span className="opacity-90">{status.countdownToNext}</span>
          </div>
        </div>
      </div>

      {/* ── Instrument Switcher Strip ── */}
      <div className="grid grid-cols-5 gap-1.5 font-mono text-[10px]">
        {(['GOLD', 'DOW', 'NASDAQ', 'NIKKEI', 'OIL'] as const).map((inst) => {
          const cfg = ASIAN_EDGE_CONFIGS[inst]!
          const isSelected = selectedInst === inst
          const isGated = cfg.status === 'GATED_AVOID'

          return (
            <button
              key={inst}
              type="button"
              onClick={() => setSelectedInst(inst)}
              className={`p-1.5 rounded-lg border text-center transition flex flex-col items-center justify-center gap-0.5 ${
                isSelected
                  ? 'bg-amber-950/80 border-amber-500/80 text-amber-200 shadow-md font-bold'
                  : isGated
                  ? 'bg-neutral-900/60 border-neutral-800 text-neutral-500 hover:text-neutral-400'
                  : 'bg-surface-900 border-neutral-800 text-neutral-300 hover:border-neutral-700'
              }`}
            >
              <span className="font-bold text-[10px]">
                {inst === 'GOLD' ? 'MGC Gold' : inst === 'DOW' ? 'MYM Dow' : inst === 'NASDAQ' ? 'MNQ NQ' : inst === 'NIKKEI' ? 'NKD Nikkei' : 'MCL Oil'}
              </span>
              <span className={`text-[8px] ${isGated ? 'text-red-400' : 'text-emerald-400'}`}>
                {inst === 'GOLD' ? 'PF 3.11' : inst === 'DOW' ? 'PF 1.53' : inst === 'NASDAQ' ? 'PF 1.24' : inst === 'NIKKEI' ? 'OR15 Fade' : 'GATED'}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Quick Ask Leo Button ── */}
      <button
        type="button"
        onClick={() =>
          onAskLeo(
            `Leo, evaluate the current Asian Edge setup for ${selectedInst}. What are the exact execution times, stop loss, take profit target, and session outing deadline?`
          )
        }
        className="w-full py-1.5 px-2.5 rounded-lg bg-surface-900 hover:bg-surface-800 border border-surface-700 text-neutral-200 font-mono text-[10px] font-semibold flex items-center justify-between transition"
      >
        <span className="flex items-center gap-1.5">
          <span>🤖</span>
          <span>Ask Leo to Audit {selectedInst} Asian Edge Levels</span>
        </span>
        <span className="text-amber-400">Ask Leo ↵</span>
      </button>

      {/* ── 4 Organized Operational Notes (Executing, Outing, Stop, Take Profit) ── */}
      <div className="space-y-2">
        {/* 1. Execution Note */}
        <div className="p-2.5 rounded-xl bg-surface-900/90 border border-emerald-500/40 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-xs text-emerald-300 flex items-center gap-1.5">
              <span>⚡</span> 1. Execution Timing & Orders
            </span>
            <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300">
              {ASIAN_EDGE_CONFIGS[selectedInst]?.execWindow || '02:00 – 03:30 ET'}
            </span>
          </div>
          <p className="text-[11px] text-neutral-200 leading-relaxed font-sans">
            {status.notes.executionNote}
          </p>
          {status.buyStop != null && status.sellStop != null && (
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px] font-mono">
              <div className="p-1.5 rounded bg-emerald-950/40 border border-emerald-800/60">
                <span className="text-neutral-400 block text-[9px]">BUY STOP (LONG)</span>
                <span className="text-emerald-400 font-bold text-xs">{status.buyStop.toFixed(2)}</span>
              </div>
              <div className="p-1.5 rounded bg-red-950/40 border border-red-800/60">
                <span className="text-neutral-400 block text-[9px]">SELL STOP (SHORT)</span>
                <span className="text-red-400 font-bold text-xs">{status.sellStop.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* 2. Outing & Flatten Note */}
        <div className="p-2.5 rounded-xl bg-surface-900/90 border border-red-500/40 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-xs text-red-300 flex items-center gap-1.5">
              <span>🛑</span> 2. Outing & Flatten Mandate
            </span>
            <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-red-950 border border-red-700 text-red-300">
              {ASIAN_EDGE_CONFIGS[selectedInst]?.outingWindow || '10:25 ET'}
            </span>
          </div>
          <p className="text-[11px] text-neutral-200 leading-relaxed font-sans">
            {status.notes.outingNote}
          </p>
        </div>

        {/* 3. Stop Loss Note */}
        <div className="p-2.5 rounded-xl bg-surface-900/90 border border-amber-500/40 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-xs text-amber-300 flex items-center gap-1.5">
              <span>🛡️</span> 3. Stop Loss Placement
            </span>
            {status.stopLoss != null && (
              <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-600">
                SL: {status.stopLoss.toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-200 leading-relaxed font-sans">
            {status.notes.stopLossNote}
          </p>
        </div>

        {/* 4. Take Profit Note */}
        <div className="p-2.5 rounded-xl bg-surface-900/90 border border-blue-500/40 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-xs text-blue-300 flex items-center gap-1.5">
              <span>🎯</span> 4. Take Profit Target (1.5R)
            </span>
            {status.takeProfit != null && (
              <span className="text-[10px] font-mono font-bold text-blue-300 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-600">
                TP: {status.takeProfit.toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-200 leading-relaxed font-sans">
            {status.notes.takeProfitNote}
          </p>
        </div>
      </div>

      {/* ── Telegram Notification Center ── */}
      <div className="p-3 rounded-xl bg-neutral-900/95 border border-sky-500/40 space-y-2.5 shadow-md">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">📱</span>
            <div>
              <span className="font-mono font-bold text-xs text-sky-200 block">
                Telegram Asian Edge Alerts
              </span>
              <span className="text-[9.5px] font-mono text-neutral-400">
                Bot: @AsianEdge1bot • Chat ID: 578059474
              </span>
            </div>
          </div>
          <span className="text-[9.5px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-700/60">
            Active
          </span>
        </div>

        <p className="text-[10.5px] text-neutral-300 font-sans leading-normal">
          Instant push alerts sent for order execution timing (02:00 ET), order cancels (03:30 ET), take profit & stop loss fills, and mandatory session outing (10:25 ET).
        </p>

        {/* Telegram Test Button & Links */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={telegramStatus.loading}
              onClick={handleTestTelegram}
              className="flex-1 py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-mono text-[10.5px] font-bold transition flex items-center justify-center gap-1.5 shadow"
            >
              <span>{telegramStatus.loading ? '⏳' : '🚀'}</span>
              <span>{telegramStatus.loading ? 'Dispatching...' : 'Send Test Alert to Telegram'}</span>
            </button>
            <a
              href="https://t.me/AsianEdge1bot"
              target="_blank"
              rel="noopener noreferrer"
              className="py-1.5 px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sky-300 font-mono text-[10px] border border-neutral-700 transition flex items-center gap-1"
            >
              <span>Open Bot</span>
              <span>↗</span>
            </a>
          </div>

          {/* Feedback Message */}
          {telegramStatus.message && (
            <div
              className={`p-2 rounded-lg text-[10px] font-mono border leading-relaxed ${
                telegramStatus.success
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/50 text-red-200'
              }`}
            >
              <div>{telegramStatus.message}</div>
              {telegramStatus.isChatNotFound && (
                <div className="mt-1 text-[9.5px] text-amber-300">
                  👉 Click <strong>Open Bot ↗</strong> above, press <strong>START</strong> in Telegram, and retry!
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

/**
 * Dow Rotation and Credit Markets Health Component
 * Market: CME E-mini Dow Futures (YM)
 *
 * Implements:
 * 1. Cross-Market & Sector Rotation: YM vs NQ vs ES vs RTY + Cyclical vs Tech Growth
 * 2. Corporate Credit Spreads & Bank Health: HYG/LQD, High-Yield OAS (bps), Credit Stress Regime
 */

import React from 'react'
import type { DowRotationState, DowCreditState, DowTelemetry } from '@/types/fundamentals'

interface DowRotationCreditCardProps {
  rotation: DowRotationState
  credit: DowCreditState
  telemetry: DowTelemetry
}

export function DowRotationCreditCard({
  rotation,
  credit,
  telemetry,
}: DowRotationCreditCardProps) {
  const getRegimeColor = (regime: string) => {
    switch (regime) {
      case 'CYCLICAL_VALUE_OUTPERFORMANCE':
        return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
      case 'TECH_GROWTH_OUTPERFORMANCE':
        return 'text-purple-300 bg-purple-500/15 border-purple-500/30'
      case 'BROAD_RISK_ON':
        return 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30'
      case 'BROAD_RISK_OFF':
        return 'text-rose-300 bg-rose-500/15 border-rose-500/30'
      case 'DEFENSIVE_HEALTHCARE_CONSUMER':
        return 'text-amber-300 bg-amber-500/15 border-amber-500/30'
      default:
        return 'text-slate-300 bg-slate-500/15 border-slate-500/30'
    }
  }

  const getCreditRegimeColor = (regime: string) => {
    switch (regime) {
      case 'HEALTHY_EXPANSION':
        return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
      case 'MILD_COMPRESSION':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
      case 'STRESS_WIDENING':
        return 'text-amber-300 bg-amber-500/20 border-amber-500/40 animate-pulse'
      case 'ACUTE_DISLOCATION':
        return 'text-rose-300 bg-rose-500/20 border-rose-500/40 font-bold animate-pulse'
      default:
        return 'text-slate-300 bg-slate-500/15 border-slate-500/30'
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {/* 1. Cross-Market & Sector Rotation Engine */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 backdrop-blur-sm shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🔄</span>
              <h3 className="text-base font-bold text-slate-100">
                Cross-Market &amp; Sector Rotation Engine
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              YM (Blue-Chip) vs NQ (Duration Tech) vs ES (Broad 500) vs RTY (Small-Cap)
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border ${getRegimeColor(rotation.rotationRegime)}`}>
            {rotation.rotationRegime.replace(/_/g, ' ')}
          </span>
        </div>

        {/* 4 Index Futures Cards */}
        <div className="grid grid-cols-4 gap-2 text-center font-mono">
          <div className="bg-slate-950/70 border border-blue-500/40 rounded-lg p-2.5">
            <span className="text-[10px] text-blue-400 block font-bold">YM (Dow)</span>
            <div className="text-sm font-bold text-slate-100 mt-0.5">
              {telemetry.ymPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <span
              className={`text-xs font-semibold ${
                telemetry.ymChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {telemetry.ymChangePct >= 0 ? '+' : ''}
              {telemetry.ymChangePct.toFixed(2)}%
            </span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">NQ (Nasdaq)</span>
            <div className="text-sm font-bold text-slate-100 mt-0.5">
              {telemetry.nqPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <span
              className={`text-xs font-semibold ${
                telemetry.nqChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {telemetry.nqChangePct >= 0 ? '+' : ''}
              {telemetry.nqChangePct.toFixed(2)}%
            </span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">ES (S&amp;P 500)</span>
            <div className="text-sm font-bold text-slate-100 mt-0.5">
              {telemetry.esPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
            </div>
            <span
              className={`text-xs font-semibold ${
                telemetry.esChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {telemetry.esChangePct >= 0 ? '+' : ''}
              {telemetry.esChangePct.toFixed(2)}%
            </span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">RTY (Russell)</span>
            <div className="text-sm font-bold text-slate-100 mt-0.5">
              {telemetry.rtyPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
            </div>
            <span
              className={`text-xs font-semibold ${
                telemetry.rtyChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {telemetry.rtyChangePct >= 0 ? '+' : ''}
              {telemetry.rtyChangePct.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Sector Leadership Details */}
        <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
          <div>
            <span className="text-[10px] text-slate-400 block uppercase tracking-wider">Leading Sectors</span>
            <span className="font-semibold text-emerald-400 font-mono">
              {rotation.leadershipSector}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block uppercase tracking-wider">Lagging Sectors</span>
            <span className="font-semibold text-slate-300 font-mono">
              {rotation.laggingSector}
            </span>
          </div>
        </div>

        {/* YM vs NQ Spread Detail */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-xs font-mono flex items-center justify-between">
          <span className="text-slate-400">YM vs NQ 1-Day Spread:</span>
          <span className={`font-bold text-sm ${rotation.ymVsNqSpreadPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {rotation.ymVsNqSpreadPct >= 0 ? '+' : ''}{rotation.ymVsNqSpreadPct}%
          </span>
        </div>
      </div>

      {/* 2. Corporate Credit Spreads & Bank Health Monitor */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 backdrop-blur-sm shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💳</span>
              <h3 className="text-base font-bold text-slate-100">
                Credit Markets &amp; Bank Health Monitor
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              HY OAS Spreads, Corporate Bond ETFs (HYG/LQD), and Bank Health
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border ${getCreditRegimeColor(credit.creditStressRegime)}`}>
            {credit.creditStressRegime.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Credit Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">High Yield OAS</span>
            <div className="text-base font-bold text-slate-100 mt-0.5">
              {credit.highYieldSpreadBps > 0 ? credit.highYieldSpreadBps : '—'} <span className="text-xs text-slate-400">bps</span>
            </div>
            <span className="text-[10px] text-slate-400 font-sans">{credit.highYieldSpreadBps > 0 ? 'FRED BAMLH0A0HYM2' : 'Not on this feed'}</span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">Inv. Grade OAS</span>
            <div className="text-base font-bold text-slate-100 mt-0.5">
              {credit.investmentGradeSpreadBps > 0 ? credit.investmentGradeSpreadBps : '—'} <span className="text-xs text-slate-400">bps</span>
            </div>
            <span className="text-[10px] text-slate-400 font-sans">Stable</span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">HYG ETF Price</span>
            <div className="text-sm font-bold text-slate-100 mt-0.5">
              ${credit.hygPrice.toFixed(2)}
            </div>
            <span
              className={`text-xs font-semibold ${
                credit.hygChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {credit.hygChangePct >= 0 ? '+' : ''}
              {credit.hygChangePct.toFixed(2)}%
            </span>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">Bank Sector (XLF)</span>
            <div className="text-sm font-bold text-slate-100 mt-0.5">
              Financials
            </div>
            <span
              className={`text-xs font-semibold ${
                credit.bankSectorChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {credit.bankSectorChangePct >= 0 ? '+' : ''}
              {credit.bankSectorChangePct.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Credit Safeguard / Divergence Alert */}
        <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 text-xs font-mono leading-relaxed">
          <span className="font-bold text-amber-400">CREDIT ENGINE PRINCIPLE (Prompt 10): </span>
          When credit spreads widen sharply while equities appear quiet, mature corporations face refinancing headwinds and banks tighten loan standards. Look for HYG volume breakdown as an early warning signal of macro equity liquidation.
        </div>
      </div>
    </div>
  )
}

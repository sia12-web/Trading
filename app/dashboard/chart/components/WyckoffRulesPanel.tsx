'use client'

import React from 'react'

interface WyckoffRulesPanelProps {
  instrument: string
  onAskLeo: (prompt: string) => void
}

export function WyckoffRulesPanel({ instrument, onAskLeo }: WyckoffRulesPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs flex flex-col min-h-0 select-text">
      {/* Header Banner */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/70 via-surface-900 to-emerald-950/70 border border-emerald-500/50 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏛️</span>
            <div>
              <h3 className="text-xs font-mono font-bold text-white tracking-wide">
                The 22-Rule Wyckoff Strategy & Execution Rules
              </h3>
              <p className="text-[10px] text-emerald-300/80 font-mono">
                Deterministic Intraday Method for NQ, ES, YM, Gold, Oil
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold">
            Active: {instrument}
          </span>
        </div>
      </div>

      {/* Quick-Ask Leo Strategy Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 font-mono text-[10px]">
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, audit the 4 Wyckoff execution setups for ${instrument} (Spring, Upthrust, Breakout Retest, Breakdown Retest). Tell me if price is interacting with our frozen pre-market Tier 1 zones.`
            )
          }
          className="p-2 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🎯</span>
          <span>Audit 4 Setups on {instrument}</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, check our pre-market Tier 1 zones on ${instrument} (5D Volume Profile, Yesterday's Profile, Overnight). Which pre-marked zone is price approaching right now?`
            )
          }
          className="p-2 rounded-lg bg-surface-900 hover:bg-surface-800 border border-surface-700 text-gray-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>🗺️</span>
          <span>Check Frozen Tier 1 Map</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onAskLeo(
              `Leo, audit CVD and volume on ${instrument} for effort versus result. Is aggressive order flow being absorbed at key levels?`
            )
          }
          className="p-2 rounded-lg bg-purple-950/50 hover:bg-purple-900/60 border border-purple-500/40 text-purple-200 font-semibold text-left transition flex items-center gap-1.5"
        >
          <span>📊</span>
          <span>Audit CVD Effort vs Result</span>
        </button>
      </div>

      {/* 1. The ONLY 4 Trades in the Universe */}
      <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-2.5">
        <div className="flex items-center justify-between border-b border-surface-800 pb-1.5">
          <span className="font-mono font-bold text-xs text-white flex items-center gap-1.5">
            <span>⚡</span> The ONLY 4 Trades in the Universe (Rule 11)
          </span>
          <span className="text-[9.5px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/60">
            Everything Else: IGNORE
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10.5px]">
          {/* Setup 1: Spring */}
          <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 space-y-1">
            <div className="font-bold text-emerald-300 font-mono flex items-center justify-between">
              <span>1. Support: Spring → Reclaim</span>
              <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-300">LONG</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price reaches predetermined support zone → sweeps underneath → sellers fail to continue → price reclaims zone → <strong>LONG</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Strictly below spring low.<br />
              • <strong>CVD:</strong> Price equal/higher low while CVD lower low (Buyer Absorption).
            </div>
          </div>

          {/* Setup 2: Upthrust */}
          <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-500/30 space-y-1">
            <div className="font-bold text-rose-300 font-mono flex items-center justify-between">
              <span>2. Resistance: Upthrust → Return</span>
              <span className="text-[9px] px-1 rounded bg-rose-500/20 text-rose-300">SHORT</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price reaches predetermined resistance → breaks above → failure to continue → price returns below resistance → <strong>SHORT</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Strictly above upthrust high.<br />
              • <strong>CVD:</strong> Price same/lower high while CVD higher high (Seller Absorption).
            </div>
          </div>

          {/* Setup 3: Breakout Retest */}
          <div className="p-2 rounded-lg bg-cyan-950/30 border border-cyan-500/30 space-y-1">
            <div className="font-bold text-cyan-300 font-mono flex items-center justify-between">
              <span>3. Breakout → Successful Retest</span>
              <span className="text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-300">LONG (SOS → LPS)</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price destroys resistance with initiative volume. Don&apos;t chase initial candle! Wait for pullback to hold as support → <strong>LONG continuation</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Below retest floor.<br />
              • <strong>Rule:</strong> Never chase initial breakout.
            </div>
          </div>

          {/* Setup 4: Breakdown Retest */}
          <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-500/30 space-y-1">
            <div className="font-bold text-amber-300 font-mono flex items-center justify-between">
              <span>4. Breakdown → Failed Reclaim</span>
              <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">SHORT (SOW → LPSY)</span>
            </div>
            <p className="text-gray-300 text-[10px] leading-tight">
              Price cleanly destroys support zone with initiative volume. Wait for weak bounce that fails to reclaim → <strong>SHORT continuation</strong>.
            </p>
            <div className="text-[9px] text-gray-400 font-mono">
              • <strong>Stop:</strong> Above failed reclaim high.<br />
              • <strong>Target:</strong> Next 5D/Yesterday support zone.
            </div>
          </div>
        </div>
      </div>

      {/* 2. Chart Hierarchy */}
      <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-2">
        <span className="font-mono font-bold text-xs text-white flex items-center gap-1.5">
          <span>📊</span> Final Chart Hierarchy (Rule 2)
        </span>
        <div className="space-y-1.5 text-[10.5px]">
          <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold text-[9px] shrink-0">
              TIER 1 (MANDATORY)
            </span>
            <span className="text-gray-300 text-[10px]">
              <strong>Price + Rolling 5D Profile (POC, HVN, LVN) + Yesterday&apos;s Profile (VAH, POC, VAL, High, Low) + Overnight Levels.</strong> Pre-market map frozen at 9:30 ET.
            </span>
          </div>
          <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold text-[9px] shrink-0">
              TIER 2 (CONFIRMATION)
            </span>
            <span className="text-gray-300 text-[10px]">
              <strong>Volume Bars (Effort vs. Result) + CVD (Aggressive Order Flow & Absorption).</strong> Confirms entry confidence; price reclaim triggers trade.
            </span>
          </div>
          <div className="p-2 rounded bg-surface-950/70 border border-surface-800 flex items-start gap-2">
            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold text-[9px] shrink-0">
              TIER 3 (CONTEXT ONLY)
            </span>
            <span className="text-gray-300 text-[10px]">
              <strong>5-Month Anchored VWAP + Cross-Asset Volatility Gauges (VIX1D, OVX, GVZ).</strong> Background context only; does NOT trigger trades. <em>Tier 3 can NEVER override Tier 1.</em>
            </span>
          </div>
        </div>
      </div>

      {/* 3. The 8-Step Screen-Reading Sequence */}
      <div className="p-3 rounded-xl bg-surface-900/90 border border-surface-800 space-y-1.5">
        <span className="font-mono font-bold text-xs text-white flex items-center gap-1.5">
          <span>🎯</span> The 8-Step Screen-Reading Sequence (Rule 23)
        </span>
        <div className="flex flex-wrap items-center gap-1 font-mono text-[9.5px] text-gray-300 pt-1">
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">1. LOCATION</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">2. REACTION</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">3. RESULT</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">4. CVD + VOL</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">5. TRIGGER</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">6. RISK</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-surface-800 font-bold text-white">7. REWARD (≥2R)</span>
          <span>→</span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-300 font-bold">8. ENTER</span>
        </div>
      </div>

      {/* 4. Absolute Filters: When NOT to Trade */}
      <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 space-y-2">
        <span className="font-mono font-bold text-xs text-rose-300 flex items-center gap-1.5">
          <span>🚫</span> When You Do NOT Trade - Absolute Filters (Rule 20)
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[10px] text-gray-300 font-mono">
          <div>• No predetermined zone = <strong>NO TRADE</strong></div>
          <div>• Middle of value / POC chop = <strong>NO TRADE</strong></div>
          <div>• Random range away from zones = <strong>NO TRADE</strong></div>
          <div>• Spring without reclaim = <strong>NO TRADE</strong></div>
          <div>• Upthrust without return below = <strong>NO TRADE</strong></div>
          <div>• Breakout without pullback = <strong>DON&apos;T CHASE</strong></div>
          <div>• Less than 2R room to next zone = <strong>NO TRADE</strong></div>
          <div>• Nothing happens all day = <strong>ZERO TRADES (Fully OK)</strong></div>
        </div>
      </div>

      {/* 5. Risk & Stop Discipline */}
      <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-1.5 text-[10.5px]">
        <span className="font-mono font-bold text-xs text-amber-300 flex items-center gap-1.5">
          <span>🛡️</span> Risk & Stop Discipline (Rules 17, 18, 19)
        </span>
        <p className="text-gray-300 text-[10px] leading-relaxed">
          • <strong>Minimum 2R Target:</strong> Check distance to next major zone BEFORE entering. If &lt; 2R room, skip the trade.<br />
          • <strong>Stop Loss:</strong> Set strictly by market structure (below Spring low / above Upthrust high). Position size is calculated from fixed 1R risk.<br />
          • <strong>Never Widen the Stop:</strong> If structural invalidation is breached, you are wrong. Exit immediately. Never turn -1R into -3R while conducting an emergency seminar.
        </p>
      </div>
    </div>
  )
}

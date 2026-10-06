'use client'

/**
 * Gold ETF Flows, CFTC Positioning & COMEX Depository Inventories
 * Implements Items 11, 13, 14, 17, 18, 19, 32, 33
 */

import React from 'react'
import type {
  GoldEtfFlowState,
  CftcGoldPositioningState,
  ComexDepositoryInventoryState,
  CentralBankDemandState,
} from '@/types/fundamentals'

interface GoldEtfCftcComexCardProps {
  etfFlows: GoldEtfFlowState
  cftc: CftcGoldPositioningState
  comex: ComexDepositoryInventoryState
  centralBank: CentralBankDemandState
}

export function GoldEtfCftcComexCard({
  etfFlows,
  cftc,
  comex,
  centralBank,
}: GoldEtfCftcComexCardProps) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <h2 className="text-lg font-bold text-slate-100">
              Institutional Flows: WGC ETFs, CFTC & COMEX Depositories
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              Items 11, 13, 17, 18, 19
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Medium-to-longer term physical, speculative and sovereign anchors. Not for 9:47 AM intraday triggers.
          </p>
        </div>
      </div>

      {/* 4 Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
        {/* Pillar 1: World Gold Council ETF Flows (Items 13 & 14) */}
        <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-purple-400">
              <span>📦</span>
              <span>1. World Gold Council ETF Flows</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              Multi-week Context
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 my-2 text-xs font-mono">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Global Holdings:</span>
              <span className="text-base font-bold text-slate-100">{etfFlows.globalTonnes > 0 ? `${etfFlows.globalTonnes} t` : '—'}</span>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Monthly Flow:</span>
              <span className={`text-base font-bold ${etfFlows.monthlyChangeTonnes >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {etfFlows.monthlyChangeTonnes >= 0 ? '+' : ''}{etfFlows.monthlyChangeTonnes} t
              </span>
            </div>
          </div>

          <div className="text-[11px] text-slate-300 space-y-1 mb-2">
            <div>SPDR GLD: <span className="font-mono text-slate-100">{etfFlows.gldHoldingsTonnes} t</span> · iShares IAU: <span className="font-mono text-slate-100">{etfFlows.iauHoldingsTonnes} t</span></div>
            <div className="text-emerald-400 font-medium">Flow Signal: {etfFlows.divergenceSignal}</div>
          </div>

          <div className="p-2 rounded bg-slate-900/60 border border-slate-800/80 text-[10px] text-slate-400 italic">
            ℹ️ Item 14 Guidance: ETF flows are weekly/monthly aggregates for macro context, never for intraday order entry.
          </div>
        </div>

        {/* Pillar 2: CFTC Speculative Positioning (Item 17) */}
        <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
              <span>🎯</span>
              <span>2. CFTC Managed Money Positioning</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              {cftc.reportDate.split(' ')[0]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 my-2 text-xs font-mono">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Net Managed Money:</span>
              <span className="text-base font-bold text-slate-100">
                {cftc.netManagedMoney.toLocaleString()}
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Crowding Index (0-100):</span>
              <span className={`text-base font-bold ${cftc.crowdingIndex > 80 ? 'text-rose-400' : 'text-amber-400'}`}>
                {cftc.crowdingIndex}/100 ({cftc.liquidationRisk} Risk)
              </span>
            </div>
          </div>

          <div className="text-[11px] text-slate-300 space-y-1 mb-2">
            <div>Gross Longs: <span className="font-mono text-emerald-400">{cftc.managedMoneyLong.toLocaleString()}</span> vs Shorts: <span className="font-mono text-rose-400">{cftc.managedMoneyShort.toLocaleString()}</span> ({cftc.longShortRatio.toFixed(1)}:1 ratio)</div>
            <div className="text-slate-400">4-Week Net Stretch: [{cftc.fourWeekTrend.map((v) => `${Math.round(v / 1000)}k`).join(' → ')}]</div>
          </div>

          <div className="p-2 rounded bg-slate-900/60 border border-slate-800/80 text-[10px] text-amber-300/90">
            ⚠️ Crowding Alert: If price fails to make higher highs on positive news while CVD stalls, heavy long crowding warns of high long-liquidation risk.
          </div>
        </div>

        {/* Pillar 3: COMEX Depository Stocks (Items 18 & 19) */}
        <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
              <span>🏭</span>
              <span>3. COMEX Depository Stocks & Notices</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              {comex.reportDate}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 my-2 text-xs font-mono">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Registered Ounces:</span>
              <span className="text-base font-bold text-slate-100">
                {(comex.registeredOz / 1e6).toFixed(2)}M oz
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Eligible Ounces:</span>
              <span className="text-base font-bold text-slate-100">
                {(comex.eligibleOz / 1e6).toFixed(2)}M oz
              </span>
            </div>
          </div>

          <div className="text-[11px] text-slate-300 space-y-1 mb-2">
            <div>Total Depository: <span className="font-mono text-slate-100">{(comex.totalOz / 1e6).toFixed(2)}M oz</span> · Delivery Notices: <span className="font-mono text-amber-300">{comex.deliveryNotices}</span></div>
            <div className="text-slate-400 font-mono">Net 20d Change: {(comex.change20dOz / 1e3).toFixed(0)}k oz</div>
          </div>

          {/* Institutional Warning Banner (Item 19) */}
          <div className="p-2.5 rounded bg-rose-950/30 border border-rose-800/40 text-[10px] text-rose-200">
            <span className="font-bold text-rose-300 block mb-0.5">⚠️ Institutional Safeguard (Item 19):</span>
            {comex.warningDisclaimer}
          </div>
        </div>

        {/* Pillar 4: Central Bank Demand & IMF Reserves (Items 11 & 32) */}
        <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <span>🏦</span>
              <span>4. Central Bank Demand & IMF Reserves</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              Sovereign Anchor
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 my-2 text-xs font-mono">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Annual Purchases Run-Rate:</span>
              <span className="text-base font-bold text-emerald-400">
                {centralBank.annualNetPurchasesTonnes} t/yr
              </span>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-400 text-[10px] block">PBOC Reported Gold:</span>
              <span className="text-base font-bold text-slate-100">
                {(centralBank.pbocReportedOunces / 1e6).toFixed(2)}M oz
              </span>
            </div>
          </div>

          <div className="text-[11px] text-slate-300 space-y-1 mb-2">
            <div>Pace: <span className="font-bold text-emerald-400">{centralBank.reserveDiversificationPace}</span> · Source: <span className="text-slate-400">{centralBank.imfDataTimestamp}</span></div>
            <div className="text-slate-300">{centralBank.pbocPurchasesStatus}</div>
          </div>

          <div className="p-2 rounded bg-slate-900/60 border border-slate-800/80 text-[10px] text-slate-400 italic">
            ℹ️ Item 32 Guidance: Central bank demand forms a structural long-term floor. It does not dictate an immediate 10:04 AM trade.
          </div>
        </div>
      </div>
    </div>
  )
}

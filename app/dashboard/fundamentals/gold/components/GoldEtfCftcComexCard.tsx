'use client'

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

export function GoldEtfCftcComexCard(_props: GoldEtfCftcComexCardProps) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      <h2 className="text-lg font-bold text-slate-100">ETF, CFTC, and COMEX stocks</h2>
      <p className="text-sm text-slate-300 mt-2">
        Unavailable. World Gold Council tonnes, CFTC positioning, COMEX warehouse stocks, and central-bank purchases are not on a live feed.
      </p>
    </div>
  )
}

'use client'

/**
 * Per-Market Situations & Leo Rules Page
 * Displays active conditional rules, stagnation timeouts, and situation states
 * for each market (DOW, NASDAQ, GOLD, CRUDE) evaluated by Leo.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { DeskNewsInstrument } from '@/lib/trading/deskNews'
import { isArmedRuleExpired } from '@/lib/trading/sessionGate'

export interface ArmedRule {
  id: string
  type: 'STAGNATION_TIMEOUT' | 'DESK_ALERT' | 'TELEGRAM_ALERT' | 'CONDITIONAL_ENTRY'
  description: string
  userPrompt?: string
  instrument?: string
  direction?: 'LONG' | 'SHORT'
  targetReference?: string
  targetPrice?: number
  pattern?: string
  stopLoss?: number
  takeProfit?: number
  size?: number
  maxMinutes?: number
  session?: string
  isLongTerm?: boolean
  createdAt: number
  status: 'ARMED' | 'TRIGGERED' | 'EXECUTED' | 'SATISFIED' | 'CANCELLED' | 'EXPIRED'
}

const MARKETS: DeskNewsInstrument[] = ['DOW', 'NASDAQ', 'GOLD', 'CRUDE']

export default function SituationsPage() {
  const [selectedMarket, setSelectedMarket] = useState<DeskNewsInstrument | 'ALL'>('ALL')
  const [rulesByMarket, setRulesByMarket] = useState<Record<string, ArmedRule[]>>({})

  const loadRules = () => {
    if (typeof window === 'undefined') return
    const acc: Record<string, ArmedRule[]> = {}
    for (const inst of MARKETS) {
      try {
        const saved = localStorage.getItem(`leo_armed_rules_${inst}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed)) {
            acc[inst] = parsed.filter((r: ArmedRule) => !isArmedRuleExpired(r))
          } else {
            acc[inst] = []
          }
        } else {
          acc[inst] = []
        }
      } catch {
        acc[inst] = []
      }
    }
    setRulesByMarket(acc)
  }

  useEffect(() => {
    loadRules()
    const interval = setInterval(loadRules, 10_000)
    return () => clearInterval(interval)
  }, [])

  const cancelRule = (inst: string, ruleId: string) => {
    const current = rulesByMarket[inst] || []
    const updated = current.filter((r) => r.id !== ruleId)
    localStorage.setItem(`leo_armed_rules_${inst}`, JSON.stringify(updated))
    setRulesByMarket((prev) => ({ ...prev, [inst]: updated }))
  }

  const clearAllMarketRules = (inst: string) => {
    localStorage.setItem(`leo_armed_rules_${inst}`, JSON.stringify([]))
    setRulesByMarket((prev) => ({ ...prev, [inst]: [] }))
  }

  const activeMarkets = selectedMarket === 'ALL' ? MARKETS : [selectedMarket]
  const totalArmedCount = Object.values(rulesByMarket)
    .flat()
    .filter((r) => r.status === 'ARMED').length

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-surface-600 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Market Situations & Leo Rules</h1>
            <span className="rounded-full bg-violet-500/20 px-2.5 py-0.5 text-xs font-mono font-semibold text-violet-300 border border-violet-500/30">
              {totalArmedCount} Armed Situation{totalArmedCount === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-400 max-w-xl leading-relaxed">
            Active conditional strategies, level monitors, and stagnation rules evaluated per market by Leo.
          </p>
        </div>

        <Link
          href="/dashboard/chart"
          className="rounded-lg border border-sky-600/40 bg-sky-950/40 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900/50 hover:text-white transition"
        >
          Open Chart Desk →
        </Link>
      </div>

      {/* Market Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedMarket('ALL')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border transition ${
            selectedMarket === 'ALL'
              ? 'border-brand-500/50 bg-brand-600/30 text-brand-100'
              : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
          }`}
        >
          All Markets
        </button>
        {MARKETS.map((m) => {
          const count = (rulesByMarket[m] || []).filter((r) => r.status === 'ARMED').length
          return (
            <button
              key={m}
              type="button"
              onClick={() => setSelectedMarket(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border transition flex items-center gap-1.5 ${
                selectedMarket === m
                  ? 'border-brand-500/50 bg-brand-600/30 text-brand-100'
                  : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
              }`}
            >
              <span>{m}</span>
              {count > 0 && (
                <span className="rounded-full bg-amber-500/30 text-amber-200 text-[10px] px-1.5 py-0.2 font-mono">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Market Situations Grid */}
      <div className="space-y-6">
        {activeMarkets.map((inst) => {
          const rules = rulesByMarket[inst] || []
          const armedRules = rules.filter((r) => r.status === 'ARMED')
          const historyRules = rules.filter((r) => r.status !== 'ARMED')

          return (
            <section
              key={inst}
              className="rounded-xl border border-surface-600 bg-surface-800/60 p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-600/70 pb-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-brand-500/20 px-2.5 py-1 text-sm font-bold text-brand-300 font-mono border border-brand-500/30">
                    {inst} Desk
                  </span>
                  <span className="text-xs text-gray-400">
                    {armedRules.length} Active Rule{armedRules.length === 1 ? '' : 's'}
                  </span>
                </div>
                {rules.length > 0 && (
                  <button
                    type="button"
                    onClick={() => clearAllMarketRules(inst)}
                    className="text-xs text-red-400 hover:text-red-300 font-medium transition font-mono"
                  >
                    Clear {inst} Rules
                  </button>
                )}
              </div>

              {rules.length === 0 ? (
                <div className="py-4 text-center text-xs text-gray-500">
                  No active conditional situations for {inst}. Speak to Leo on the {inst} chart tab to arm strategy rules.
                </div>
              ) : (
                <div className="space-y-3">
                  {armedRules.map((rule) => (
                    <SituationCard
                      key={rule.id}
                      rule={rule}
                      onCancel={() => cancelRule(inst, rule.id)}
                    />
                  ))}
                  {historyRules.map((rule) => (
                    <SituationCard
                      key={rule.id}
                      rule={rule}
                      onCancel={() => cancelRule(inst, rule.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function SituationCard({
  rule,
  onCancel,
}: {
  rule: ArmedRule
  onCancel: () => void
}) {
  const isArmed = rule.status === 'ARMED'
  const isTriggered = rule.status === 'TRIGGERED' || rule.status === 'EXECUTED'
  const isExpired = rule.status === 'EXPIRED' || rule.status === 'CANCELLED'

  const badgeTone = isArmed
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    : isTriggered
      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      : 'bg-gray-500/20 text-gray-400 border-gray-500/30'

  return (
    <div
      className={`rounded-lg border p-3.5 space-y-2 transition ${
        isArmed
          ? 'border-emerald-600/40 bg-emerald-950/20'
          : isTriggered
            ? 'border-amber-600/40 bg-amber-950/20'
            : 'border-surface-600/60 bg-surface-900/40 opacity-60'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded px-2 py-0.5 font-bold uppercase tracking-wider text-[10px] border ${badgeTone}`}>
            {rule.status}
          </span>
          {rule.direction && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase font-mono ${
                rule.direction === 'LONG'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-red-500/20 text-red-300'
              }`}
            >
              {rule.direction}
            </span>
          )}
          {rule.pattern && (
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200 border border-violet-500/30 font-mono">
              {rule.pattern.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
          <span>{new Date(rule.createdAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
          {!isExpired && (
            <button
              type="button"
              onClick={onCancel}
              className="text-red-400 hover:text-red-300 font-medium ml-2"
            >
              Cancel Rule
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-white font-medium leading-snug">{rule.description}</p>

      {rule.userPrompt && (
        <blockquote className="border-l-2 border-brand-500/50 pl-2 text-[11px] text-gray-400 italic">
          &quot;{rule.userPrompt}&quot;
        </blockquote>
      )}

      {rule.targetPrice && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-gray-400 pt-1 border-t border-white/5">
          <span>Target: <strong className="text-gray-200">{rule.targetReference || 'Level'} @ {rule.targetPrice.toLocaleString()}</strong></span>
          {rule.stopLoss && <span>SL: <strong className="text-red-300">{rule.stopLoss.toLocaleString()}</strong></span>}
          {rule.takeProfit && <span>TP: <strong className="text-emerald-300">{rule.takeProfit.toLocaleString()}</strong></span>}
        </div>
      )}
    </div>
  )
}

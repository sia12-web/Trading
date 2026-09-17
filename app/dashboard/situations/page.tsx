'use client'

/**
 * Per-Market Situations & Leo Rules Page
 * Displays actively monitored conditional strategies, level alarms, stagnation timeouts,
 * and market situations evaluated per market (DOW, NASDAQ, GOLD, CRUDE) by Leo.
 *
 * Every situation is explicitly recorded, dated, and organized with its exact
 * trigger conditions, risk/reward execution parameters, and timing safeguards.
 */

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  ALL_MARKETS,
  loadAllRules,
  addRule,
  updateRule,
  rearmRule,
  deleteRule,
  clearMarketRules,
  listenToRuleUpdates,
  formatRuleDate,
  armMarketOneToOneSituation,
  type ArmedRule,
  type MarketInstrument,
  type RuleType,
  type TradeDirection,
  type PricePattern,
} from '@/lib/trading/leoRules'

type StatusFilter = 'ALL' | 'ARMED' | 'TRIGGERED_EXECUTED' | 'HISTORY'
type TypeFilter = 'ALL' | RuleType

export default function SituationsPage() {
  const [selectedMarket, setSelectedMarket] = useState<MarketInstrument | 'ALL'>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [rulesByMarket, setRulesByMarket] = useState<Record<MarketInstrument, ArmedRule[]>>({
    DOW: [],
    NASDAQ: [],
    GOLD: [],
    CRUDE: [],
  })
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const refreshRules = () => {
    setRulesByMarket(loadAllRules())
  }

  useEffect(() => {
    refreshRules()
    const unsubscribe = listenToRuleUpdates(() => {
      refreshRules()
    })
    const interval = setInterval(refreshRules, 8_000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [])

  // Flattened all rules list
  const allRulesList = useMemo(() => {
    return Object.values(rulesByMarket).flat().sort((a, b) => b.createdAt - a.createdAt)
  }, [rulesByMarket])

  // KPI statistics
  const stats = useMemo(() => {
    const totalArmed = allRulesList.filter((r) => r.status === 'ARMED').length
    const conditionalEntries = allRulesList.filter((r) => (r.type === 'CONDITIONAL_ENTRY' || r.type === 'MARKET_SITUATION') && r.status === 'ARMED').length
    const deskAlerts = allRulesList.filter((r) => (r.type === 'DESK_ALERT' || r.type === 'TELEGRAM_ALERT') && r.status === 'ARMED').length
    const stagnationRules = allRulesList.filter((r) => r.type === 'STAGNATION_TIMEOUT' && r.status === 'ARMED').length
    const completedHistory = allRulesList.filter((r) => r.status === 'TRIGGERED' || r.status === 'EXECUTED').length
    return { totalArmed, conditionalEntries, deskAlerts, stagnationRules, completedHistory }
  }, [allRulesList])

  // Filtered rules
  const activeMarkets = selectedMarket === 'ALL' ? ALL_MARKETS : [selectedMarket]

  const handleCancel = (inst: MarketInstrument, ruleId: string) => {
    updateRule(inst, ruleId, { status: 'CANCELLED' })
    refreshRules()
  }

  const handleRearm = (inst: MarketInstrument, ruleId: string) => {
    rearmRule(inst, ruleId)
    refreshRules()
  }

  const handleDelete = (inst: MarketInstrument, ruleId: string) => {
    deleteRule(inst, ruleId)
    refreshRules()
  }

  const handleClearMarket = (inst: MarketInstrument) => {
    if (window.confirm(`Are you sure you want to clear all situations for ${inst}?`)) {
      clearMarketRules(inst)
      refreshRules()
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-surface-600 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>Market Situations & Leo Rules</span>
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-mono font-semibold text-emerald-300 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {stats.totalArmed} Armed Situation{stats.totalArmed === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-sm text-gray-400 max-w-2xl leading-relaxed">
            Active conditional strategies, level monitors, and stagnation rules evaluated per market by Leo.
            Every situation is recorded, dated, and strictly conditioned.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              const m = selectedMarket === 'ALL' ? 'NASDAQ' : selectedMarket
              armMarketOneToOneSituation(m)
              refreshRules()
            }}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition border border-emerald-400/40 font-mono shadow-emerald-950/40 cursor-pointer"
            title={`Arm 1:1 ${selectedMarket === 'ALL' ? 'NASDAQ' : selectedMarket} live-trigger situation at market price with 1:1 risk-to-reward`}
          >
            <span>⚡</span> Arm 1:1 {selectedMarket === 'ALL' ? 'NASDAQ' : selectedMarket} (Live Now)
          </button>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition border border-brand-400/30"
          >
            <span>+</span> Arm Custom Situation
          </button>
          <Link
            href={`/dashboard/chart?instrument=${selectedMarket === 'ALL' ? 'NASDAQ' : selectedMarket}`}
            className="rounded-lg border border-sky-600/40 bg-sky-950/40 px-3.5 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/50 hover:text-white transition font-mono"
          >
            {selectedMarket === 'ALL' ? 'NASDAQ' : selectedMarket} Chart Desk →
          </Link>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-surface-600/80 bg-surface-800/60 p-3.5 space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Armed Active</div>
          <div className="text-xl font-bold font-mono text-emerald-300 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            {stats.totalArmed}
          </div>
          <div className="text-[10px] text-gray-500">Live price monitoring</div>
        </div>

        <div className="rounded-xl border border-surface-600/80 bg-surface-800/60 p-3.5 space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Trade Entries</div>
          <div className="text-xl font-bold font-mono text-brand-300">
            {stats.conditionalEntries}
          </div>
          <div className="text-[10px] text-gray-500">Pattern + level triggers</div>
        </div>

        <div className="rounded-xl border border-surface-600/80 bg-surface-800/60 p-3.5 space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Level Alarms</div>
          <div className="text-xl font-bold font-mono text-amber-300">
            {stats.deskAlerts}
          </div>
          <div className="text-[10px] text-gray-500">Desk & Telegram alerts</div>
        </div>

        <div className="rounded-xl border border-surface-600/80 bg-surface-800/60 p-3.5 space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Stagnation Rules</div>
          <div className="text-xl font-bold font-mono text-violet-300">
            {stats.stagnationRules}
          </div>
          <div className="text-[10px] text-gray-500">Auto-close timeouts</div>
        </div>

        <div className="rounded-xl border border-surface-600/80 bg-surface-800/60 p-3.5 space-y-1 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Executed / Triggered</div>
          <div className="text-xl font-bold font-mono text-cyan-300">
            {stats.completedHistory}
          </div>
          <div className="text-[10px] text-gray-500">Fulfilled situations</div>
        </div>
      </div>

      {/* Control Bar: Markets & Status Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-800/40 p-3 rounded-xl border border-surface-600/70">
        {/* Market Selector Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedMarket('ALL')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border transition ${
              selectedMarket === 'ALL'
                ? 'border-brand-500/60 bg-brand-600/30 text-brand-100 shadow-sm'
                : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20 bg-surface-900/40'
            }`}
          >
            All Markets ({allRulesList.length})
          </button>
          {ALL_MARKETS.map((m) => {
            const count = (rulesByMarket[m] || []).filter((r) => r.status === 'ARMED').length
            const total = (rulesByMarket[m] || []).length
            return (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedMarket(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border transition flex items-center gap-1.5 ${
                  selectedMarket === m
                    ? 'border-brand-500/60 bg-brand-600/30 text-brand-100 shadow-sm'
                    : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20 bg-surface-900/40'
                }`}
              >
                <span>{m}</span>
                {count > 0 ? (
                  <span className="rounded-full bg-emerald-500/30 text-emerald-200 text-[10px] px-1.5 py-0.2 font-mono font-bold">
                    {count}
                  </span>
                ) : total > 0 ? (
                  <span className="text-[10px] text-gray-500 font-mono">({total})</span>
                ) : null}
              </button>
            )
          })}
        </div>

        {/* Status & Search Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-surface-600 bg-surface-900/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                statusFilter === 'ALL' ? 'bg-surface-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('ARMED')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                statusFilter === 'ARMED' ? 'bg-emerald-600/30 text-emerald-200 shadow-sm' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Armed Only
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('TRIGGERED_EXECUTED')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                statusFilter === 'TRIGGERED_EXECUTED' ? 'bg-cyan-600/30 text-cyan-200 shadow-sm' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Triggered
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('HISTORY')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                statusFilter === 'HISTORY' ? 'bg-surface-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              History
            </button>
          </div>

          {/* Type Filter Select */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="rounded-lg border border-surface-600 bg-surface-900 px-2.5 py-1 text-xs text-white focus:outline-none focus:border-brand-500 font-mono"
          >
            <option value="ALL">All Types</option>
            <option value="CONDITIONAL_ENTRY">Entries</option>
            <option value="DESK_ALERT">Desk Alerts</option>
            <option value="TELEGRAM_ALERT">Telegram Alerts</option>
            <option value="STAGNATION_TIMEOUT">Stagnation</option>
            <option value="MARKET_SITUATION">Situations</option>
          </select>

          <input
            type="text"
            placeholder="Search situations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-surface-600 bg-surface-900 px-2.5 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 w-36 sm:w-44"
          />
        </div>
      </div>

      {/* Market Sections */}
      <div className="space-y-6">
        {activeMarkets.map((inst) => {
          let rules = rulesByMarket[inst] || []

          // Apply Status Filter
          if (statusFilter === 'ARMED') {
            rules = rules.filter((r) => r.status === 'ARMED')
          } else if (statusFilter === 'TRIGGERED_EXECUTED') {
            rules = rules.filter((r) => r.status === 'TRIGGERED' || r.status === 'EXECUTED')
          } else if (statusFilter === 'HISTORY') {
            rules = rules.filter((r) => r.status === 'EXPIRED' || r.status === 'CANCELLED' || r.status === 'SATISFIED')
          }

          // Apply Type Filter
          if (typeFilter !== 'ALL') {
            rules = rules.filter((r) => r.type === typeFilter)
          }

          // Apply Search Query
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            rules = rules.filter((r) =>
              r.description.toLowerCase().includes(q) ||
              r.userPrompt?.toLowerCase().includes(q) ||
              r.conditions.targetReference?.toLowerCase().includes(q) ||
              r.conditions.pattern?.toLowerCase().includes(q)
            )
          }

          const armedRules = rules.filter((r) => r.status === 'ARMED')
          const otherRules = rules.filter((r) => r.status !== 'ARMED')

          return (
            <section
              key={inst}
              className="rounded-xl border border-surface-600 bg-surface-800/70 p-5 space-y-4 shadow-sm"
            >
              {/* Section Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-600/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-lg bg-brand-500/20 px-3 py-1 text-sm font-bold text-brand-300 font-mono border border-brand-500/40">
                    {inst} Desk
                  </span>
                  <span className="text-xs text-gray-400 font-mono">
                    {armedRules.length} Active / {rules.length} Total
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Link
                    href={`/dashboard/chart?market=${inst}`}
                    className="text-xs text-sky-400 hover:text-sky-300 font-medium transition flex items-center gap-1"
                  >
                    Open {inst} Chart ↗
                  </Link>
                  {rules.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleClearMarket(inst)}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition font-mono border-l border-surface-600 pl-3"
                    >
                      Clear {inst}
                    </button>
                  )}
                </div>
              </div>

              {/* Rules List or Empty State */}
              {rules.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-500 space-y-2">
                  <p>No situations or rules matching filter for {inst}.</p>
                  <p className="text-[11px] text-gray-600">
                    Give Leo situations via voice/chat or click <strong>&quot;+ Arm Situation / Rule&quot;</strong> above.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Armed Active Rules First */}
                  {armedRules.map((rule) => (
                    <DetailedSituationCard
                      key={rule.id}
                      rule={rule}
                      onCancel={() => handleCancel(inst, rule.id)}
                      onRearm={() => handleRearm(inst, rule.id)}
                      onDelete={() => handleDelete(inst, rule.id)}
                    />
                  ))}

                  {/* Triggered, Executed, Expired Rules */}
                  {otherRules.map((rule) => (
                    <DetailedSituationCard
                      key={rule.id}
                      rule={rule}
                      onCancel={() => handleCancel(inst, rule.id)}
                      onRearm={() => handleRearm(inst, rule.id)}
                      onDelete={() => handleDelete(inst, rule.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {/* Modal for Arming New Situation */}
      {isModalOpen && (
        <ArmSituationModal
          onClose={() => setIsModalOpen(false)}
          onSave={(data) => {
            addRule(data)
            setIsModalOpen(false)
            refreshRules()
          }}
        />
      )}
    </div>
  )
}

/** Rich, organized situation card displaying full date and condition parameters */
function DetailedSituationCard({
  rule,
  onCancel,
  onRearm,
  onDelete,
}: {
  rule: ArmedRule
  onCancel: () => void
  onRearm: () => void
  onDelete: () => void
}) {
  const isArmed = rule.status === 'ARMED'
  const isTriggered = rule.status === 'TRIGGERED' || rule.status === 'EXECUTED'
  const isCancelled = rule.status === 'CANCELLED'
  const isExpired = rule.status === 'EXPIRED'

  const dateInfo = formatRuleDate(rule.createdAt)

  // Tone badges
  const statusBadgeColor = isArmed
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : isTriggered
      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
      : isCancelled
        ? 'bg-gray-500/20 text-gray-400 border-gray-500/30'
        : isExpired
          ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
          : 'bg-amber-500/20 text-amber-300 border-amber-500/30'

  const cardBorder = isArmed
    ? 'border-emerald-600/40 bg-surface-900/80 hover:border-emerald-500/60'
    : isTriggered
      ? 'border-cyan-600/40 bg-surface-900/80 hover:border-cyan-500/60'
      : 'border-surface-600/60 bg-surface-900/40 opacity-75'

  const cond = rule.conditions

  return (
    <div className={`rounded-xl border p-4 space-y-3.5 transition shadow-sm ${cardBorder}`}>
      {/* Top Header: Badges & Recording Date */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Badge */}
          <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider font-mono border ${statusBadgeColor}`}>
            {isArmed && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            {rule.status}
          </span>

          {/* Direction Badge */}
          {rule.direction && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase font-mono ${
                rule.direction === 'LONG'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-red-500/20 text-red-300 border border-red-500/30'
              }`}
            >
              {rule.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
            </span>
          )}

          {/* Rule Type Tag */}
          <span className="rounded bg-surface-700/80 px-2 py-0.5 text-[10px] font-semibold text-gray-300 border border-white/10 uppercase font-mono">
            {rule.type.replace(/_/g, ' ')}
          </span>

          {/* Horizon Badge */}
          <span className="rounded bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300 border border-violet-500/30 font-mono">
            {rule.isLongTerm ? '🌐 Long-Term Memory' : `⏱️ ${rule.session || 'NYC'} Session`}
          </span>
        </div>

        {/* Explicit Dating Header */}
        <div className="flex items-center gap-2 text-[11px] text-gray-400 font-mono">
          <span className="text-gray-300 font-medium">📅 {rule.createdDateFormatted || dateInfo.formatted}</span>
          {dateInfo.relative && <span className="text-gray-500">({dateInfo.relative})</span>}
        </div>
      </div>

      {/* Description & User Prompt */}
      <div className="space-y-1.5">
        <div className="text-sm text-white font-semibold flex items-center gap-2">
          <span>{rule.description}</span>
        </div>

        {rule.userPrompt && (
          <blockquote className="rounded-lg border-l-2 border-brand-500 bg-brand-950/20 px-3 py-1.5 text-xs text-gray-300 italic">
            &quot;{rule.userPrompt}&quot;
          </blockquote>
        )}
      </div>

      {/* Organized Condition Tiles / Grid */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 pt-1">
        {/* Tile 1: Trigger & Setup Conditions Checklist */}
        <div className="rounded-lg border border-surface-600/60 bg-surface-800/50 p-3 space-y-2 text-xs">
          <div className="font-semibold text-gray-300 flex items-center justify-between border-b border-white/5 pb-1 font-mono text-[11px] uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <span>🎯 1. Trigger Checklist</span>
            </span>
            {isTriggered ? (
              <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/40">
                ALL MET ✓
              </span>
            ) : (
              <span className="text-[10px] text-amber-400 font-bold bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-500/30">
                MONITORING
              </span>
            )}
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            {/* Condition 1: Target Price / Level Touch */}
            <div className={`p-1.5 rounded border flex items-center justify-between ${
              rule.conditionProgress?.levelReached || isTriggered
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : 'bg-surface-900/60 border-surface-700/50 text-gray-300'
            }`}>
              <div className="flex items-center gap-1.5 truncate">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                  rule.conditionProgress?.levelReached || isTriggered
                    ? 'bg-emerald-500 text-black'
                    : 'bg-surface-700 text-gray-400 border border-gray-600'
                }`}>
                  {rule.conditionProgress?.levelReached || isTriggered ? '✓' : '○'}
                </span>
                <span className="truncate">
                  Level: {cond.targetPrice != null ? cond.targetPrice.toLocaleString() : cond.targetReference || 'Market'}
                </span>
              </div>
              <span className="text-[10px] font-semibold shrink-0 ml-1">
                {rule.conditionProgress?.levelReached || isTriggered ? (
                  <span className="text-emerald-300 font-bold">
                    Touched {rule.conditionProgress?.levelReachedPrice ? `@ ${rule.conditionProgress.levelReachedPrice.toLocaleString()}` : '✓'}
                  </span>
                ) : (
                  <span className="text-amber-400/90 font-medium">Waiting Touch</span>
                )}
              </span>
            </div>

            {/* Condition 2: Candlestick Pattern or Touch Entry */}
            {cond.pattern && cond.pattern !== 'LEVEL_TOUCH' ? (
              <div className={`p-1.5 rounded border flex items-center justify-between ${
                rule.conditionProgress?.patternConfirmed || isTriggered
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-surface-900/60 border-surface-700/50 text-gray-300'
              }`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    rule.conditionProgress?.patternConfirmed || isTriggered
                      ? 'bg-emerald-500 text-black'
                      : 'bg-surface-700 text-gray-400 border border-gray-600'
                  }`}>
                    {rule.conditionProgress?.patternConfirmed || isTriggered ? '✓' : '○'}
                  </span>
                  <span className="truncate">Pattern: {cond.pattern.replace(/_/g, ' ')}</span>
                </div>
                <span className="text-[10px] font-semibold shrink-0 ml-1">
                  {rule.conditionProgress?.patternConfirmed || isTriggered ? (
                    <span className="text-emerald-300 font-bold">Confirmed ✓</span>
                  ) : (
                    <span className="text-amber-400/90 font-medium">Waiting Formation</span>
                  )}
                </span>
              </div>
            ) : (
              <div className={`p-1.5 rounded border flex items-center justify-between ${
                rule.conditionProgress?.levelReached || isTriggered
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-surface-900/60 border-surface-700/50 text-gray-300'
              }`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    rule.conditionProgress?.levelReached || isTriggered
                      ? 'bg-emerald-500 text-black'
                      : 'bg-surface-700 text-gray-400 border border-gray-600'
                  }`}>
                    {rule.conditionProgress?.levelReached || isTriggered ? '✓' : '○'}
                  </span>
                  <span className="truncate">Entry: Price Touch</span>
                </div>
                <span className="text-[10px] font-semibold shrink-0 ml-1">
                  {rule.conditionProgress?.levelReached || isTriggered ? (
                    <span className="text-emerald-300 font-bold">Touched ✓</span>
                  ) : (
                    <span className="text-cyan-400/90 font-medium">Direct Touch Active</span>
                  )}
                </span>
              </div>
            )}

            {/* Condition 3: Timeframe Confirmation */}
            <div className={`p-1.5 rounded border flex items-center justify-between ${
              rule.conditionProgress?.timeframeConfirmed || isTriggered
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : 'bg-surface-900/60 border-surface-700/50 text-gray-300'
            }`}>
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-emerald-500 text-black">
                  ✓
                </span>
                <span className="truncate">
                  TF: {(cond as any).entryTimeframe ? `${(cond as any).entryTimeframe}m Candle` : 'Multi-TF (Leo Monitors All)'}
                </span>
              </div>
              <span className="text-[10px] font-semibold text-emerald-300 shrink-0 ml-1">
                Active ✓
              </span>
            </div>

            {/* Condition 4: CVD Divergence (if requested) */}
            {(cond as any).cvdDivergence && (
              <div className={`p-1.5 rounded border flex items-center justify-between ${
                rule.conditionProgress?.cvdConfirmed || isTriggered
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-surface-900/60 border-surface-700/50 text-gray-300'
              }`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    rule.conditionProgress?.cvdConfirmed || isTriggered
                      ? 'bg-emerald-500 text-black'
                      : 'bg-surface-700 text-gray-400 border border-gray-600'
                  }`}>
                    {rule.conditionProgress?.cvdConfirmed || isTriggered ? '✓' : '○'}
                  </span>
                  <span className="truncate">CVD Divergence</span>
                </div>
                <span className="text-[10px] font-semibold shrink-0 ml-1">
                  {rule.conditionProgress?.cvdConfirmed || isTriggered ? (
                    <span className="text-emerald-300 font-bold">Confirmed ✓</span>
                  ) : (
                    <span className="text-amber-400/90 font-medium">Waiting Delta</span>
                  )}
                </span>
              </div>
            )}

            {/* Condition 5: Volume Spike (if requested) */}
            {cond.requireHighVolume && (
              <div className={`p-1.5 rounded border flex items-center justify-between ${
                rule.conditionProgress?.volumeConfirmed || isTriggered
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-surface-900/60 border-surface-700/50 text-gray-300'
              }`}>
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    rule.conditionProgress?.volumeConfirmed || isTriggered
                      ? 'bg-emerald-500 text-black'
                      : 'bg-surface-700 text-gray-400 border border-gray-600'
                  }`}>
                    {rule.conditionProgress?.volumeConfirmed || isTriggered ? '✓' : '○'}
                  </span>
                  <span className="truncate">High Vol Spike</span>
                </div>
                <span className="text-[10px] font-semibold shrink-0 ml-1">
                  {rule.conditionProgress?.volumeConfirmed || isTriggered ? (
                    <span className="text-emerald-300 font-bold">Confirmed ✓</span>
                  ) : (
                    <span className="text-amber-400/90 font-medium">Waiting Volume</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tile 2: Risk, Target & Execution Rules */}
        <div className="rounded-lg border border-surface-600/60 bg-surface-800/50 p-3 space-y-1.5 text-xs">
          <div className="font-semibold text-gray-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wider border-b border-white/5 pb-1 font-mono">
            <span>🛡️ 2. Risk & Execution</span>
          </div>
          <div className="space-y-1 text-gray-400 font-mono text-[11px]">
            {cond.stopLoss != null ? (
              <div className="flex justify-between">
                <span className="text-gray-500">Stop Loss:</span>
                <span className="text-red-300 font-semibold">{cond.stopLoss.toLocaleString()}</span>
              </div>
            ) : cond.stopLossMode ? (
              <div className="flex justify-between">
                <span className="text-gray-500">SL Mode:</span>
                <span className="text-red-300">{cond.stopLossMode.replace(/_/g, ' ')}</span>
              </div>
            ) : null}

            {cond.takeProfit != null ? (
              <div className="flex justify-between">
                <span className="text-gray-500">Take Profit:</span>
                <span className="text-emerald-300 font-semibold">{cond.takeProfit.toLocaleString()}</span>
              </div>
            ) : cond.takeProfitMode ? (
              <div className="flex justify-between">
                <span className="text-gray-500">TP Mode:</span>
                <span className="text-emerald-300">{cond.takeProfitMode}</span>
              </div>
            ) : null}

            {cond.riskReward && (
              <div className="flex justify-between">
                <span className="text-gray-500">R:R Ratio:</span>
                <span className="text-amber-300 font-bold">{cond.riskReward}</span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-gray-500">Size:</span>
              <span className="text-gray-200">{cond.size ?? 1} Contract{cond.size === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>

        {/* Tile 3: Timing & Invalidation Safeguards */}
        <div className="rounded-lg border border-surface-600/60 bg-surface-800/50 p-3 space-y-1.5 text-xs">
          <div className="font-semibold text-gray-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wider border-b border-white/5 pb-1 font-mono">
            <span>⏱️ 3. Safeguards & Expiry</span>
          </div>
          <div className="space-y-1 text-gray-400 font-mono text-[11px]">
            {cond.maxMinutes ? (
              <div className="flex justify-between">
                <span className="text-gray-500">Stagnation:</span>
                <span className="text-amber-300 font-medium">{cond.maxMinutes}m timeout</span>
              </div>
            ) : (
              <div className="flex justify-between">
                <span className="text-gray-500">Stagnation:</span>
                <span className="text-gray-400">Standard Rule</span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-gray-500">Validity:</span>
              <span className="text-gray-200">{rule.isLongTerm ? 'Persistent LTM' : 'NYC Session (16:00 Close)'}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">Recorded:</span>
              <span className="text-gray-400">{rule.sessionTime || dateInfo.sessionTime}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Execution Results (if triggered or executed) */}
      {rule.executedAt && (
        <div className="rounded-lg bg-cyan-950/30 border border-cyan-500/30 p-2.5 text-xs font-mono text-cyan-200 flex items-center justify-between">
          <span>🎯 Executed @ {rule.executedPrice?.toLocaleString() || 'Market'}</span>
          <span>Time: {new Date(rule.executedAt).toLocaleTimeString('en-US')}</span>
        </div>
      )}

      {/* Actions Strip */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5">
        <Link
          href={`/dashboard/chart?market=${rule.instrument}`}
          className="text-[11px] text-sky-400 hover:text-sky-300 font-medium transition"
        >
          View on {rule.instrument} Chart →
        </Link>

        <div className="flex items-center gap-3 text-xs">
          {!isArmed && (
            <button
              type="button"
              onClick={onRearm}
              className="text-emerald-400 hover:text-emerald-300 font-medium font-mono text-[11px] transition"
            >
              🔄 Re-Arm Situation
            </button>
          )}
          {isArmed && (
            <button
              type="button"
              onClick={onCancel}
              className="text-amber-400 hover:text-amber-300 font-medium font-mono text-[11px] transition"
            >
              Cancel Rule
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="text-red-400 hover:text-red-300 font-medium font-mono text-[11px] transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

/** Modal dialog to directly record & arm a new situation with structured conditions */
function ArmSituationModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (data: any) => void
}) {
  const [instrument, setInstrument] = useState<MarketInstrument>('DOW')
  const [type, setType] = useState<RuleType>('CONDITIONAL_ENTRY')
  const [direction, setDirection] = useState<TradeDirection>('LONG')
  const [description, setDescription] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [targetReference, setTargetReference] = useState('Excess Buying Low')
  const [targetPrice, setTargetPrice] = useState<number | ''>('')
  const [pattern, setPattern] = useState<PricePattern>('BULLISH_ENGULFING')
  const [stopLoss, setStopLoss] = useState<number | ''>('')
  const [takeProfit, setTakeProfit] = useState<number | ''>('')
  const [size, setSize] = useState(1)
  const [maxMinutes, setMaxMinutes] = useState<number | ''>(15)
  const [isLongTerm, setIsLongTerm] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const desc =
      description.trim() ||
      `${direction} ${size} ${instrument} on ${pattern.replace(/_/g, ' ')} at ${targetReference}${targetPrice ? ` (${targetPrice})` : ''}`

    onSave({
      instrument,
      type,
      direction,
      description: desc,
      userPrompt: userPrompt.trim() || undefined,
      targetReference,
      targetPrice: targetPrice ? Number(targetPrice) : undefined,
      pattern,
      stopLoss: stopLoss ? Number(stopLoss) : undefined,
      takeProfit: takeProfit ? Number(takeProfit) : undefined,
      size,
      maxMinutes: maxMinutes ? Number(maxMinutes) : undefined,
      isLongTerm,
      session: isLongTerm ? 'LTM' : 'NYC',
      status: 'ARMED',
      createdAt: Date.now(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-surface-600 bg-surface-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-surface-700 pb-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>🎯 Arm Market Situation / Leo Rule</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* 1-Click Presets */}
        <div className="flex items-center gap-2 rounded-lg bg-surface-800/80 p-2.5 border border-surface-700">
          <span className="text-[10px] text-gray-400 font-mono">1-Click Presets:</span>
          <button
            type="button"
            onClick={() => {
              setInstrument('NASDAQ')
              setType('MARKET_SITUATION')
              setDirection('LONG')
              setTargetReference('Live Market Touch (29,448)')
              setTargetPrice(29448)
              setPattern('LEVEL_TOUCH')
              setStopLoss(29428)
              setTakeProfit(29468)
              setSize(1)
              setIsLongTerm(true)
              setDescription('Long 1 NASDAQ on price touch at 29,448 with 1:1 R:R (20 pts SL / 20 pts TP)')
              setUserPrompt('Enter LONG 1 NASDAQ on price touch at 29,448 with 1:1 risk-to-reward')
            }}
            className="rounded-md bg-emerald-950/90 border border-emerald-500/60 hover:bg-emerald-900 px-2.5 py-1 text-[10px] font-bold text-emerald-300 transition flex items-center gap-1"
          >
            <span>⚡</span> 1:1 NASDAQ (Live Touch 29,448)
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-mono">
          {/* Market & Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 mb-1">Market</label>
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value as MarketInstrument)}
                className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white focus:outline-none focus:border-brand-500"
              >
                {ALL_MARKETS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-gray-400 mb-1">Rule Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as RuleType)}
                className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white focus:outline-none focus:border-brand-500"
              >
                <option value="CONDITIONAL_ENTRY">Conditional Entry</option>
                <option value="DESK_ALERT">Desk Alert</option>
                <option value="TELEGRAM_ALERT">Telegram Alert</option>
                <option value="STAGNATION_TIMEOUT">Stagnation Timeout</option>
                <option value="MARKET_SITUATION">Market Situation</option>
              </select>
            </div>
          </div>

          {/* Direction & Pattern */}
          {(type === 'CONDITIONAL_ENTRY' || type === 'MARKET_SITUATION') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 mb-1">Trade Direction</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDirection('LONG')}
                    className={`flex-1 py-2 rounded-lg font-bold border transition ${
                      direction === 'LONG'
                        ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500'
                        : 'bg-surface-800 text-gray-400 border-surface-600'
                    }`}
                  >
                    ▲ LONG
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('SHORT')}
                    className={`flex-1 py-2 rounded-lg font-bold border transition ${
                      direction === 'SHORT'
                        ? 'bg-red-600/30 text-red-200 border-red-500'
                        : 'bg-surface-800 text-gray-400 border-surface-600'
                    }`}
                  >
                    ▼ SHORT
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Required Pattern</label>
                <select
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value as PricePattern)}
                  className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white focus:outline-none focus:border-brand-500"
                >
                  <option value="BULLISH_ENGULFING">Bullish Engulfing</option>
                  <option value="BEARISH_ENGULFING">Bearish Engulfing</option>
                  <option value="HAMMER">Hammer / Pinbar</option>
                  <option value="SWEEP_REVERSAL">Sweep Reversal</option>
                  <option value="ABSORPTION_REVERSAL">Absorption Reversal</option>
                  <option value="BREAKOUT_RETEST">Breakout & Retest</option>
                  <option value="LEVEL_TOUCH">Level Touch Only</option>
                </select>
              </div>
            </div>
          )}

          {/* Reference Level & Target Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 mb-1">Reference Level</label>
              <input
                type="text"
                value={targetReference}
                onChange={(e) => setTargetReference(e.target.value)}
                placeholder="e.g. Excess Buying Low, Y-POC"
                className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-gray-400 mb-1">Target Trigger Price</label>
              <input
                type="number"
                step="any"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value ? parseFloat(e.target.value) : '')}
                placeholder="e.g. 52100"
                className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Stop Loss & Take Profit */}
          {(type === 'CONDITIONAL_ENTRY' || type === 'MARKET_SITUATION') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 mb-1">Stop Loss Price</label>
                <input
                  type="number"
                  step="any"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value ? parseFloat(e.target.value) : '')}
                  placeholder="e.g. 52060"
                  className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Take Profit Price</label>
                <input
                  type="number"
                  step="any"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value ? parseFloat(e.target.value) : '')}
                  placeholder="e.g. 52180"
                  className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>
          )}

          {/* Description override */}
          <div>
            <label className="block text-gray-400 mb-1">Situation Description / Title (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Long 1 DOW at Excess Buying Low on Hammer"
              className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* Size & Stagnation Timeout */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 mb-1">Position Size (Contracts)</label>
              <input
                type="number"
                min="1"
                value={size}
                onChange={(e) => setSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-gray-400 mb-1">Stagnation Timeout (Minutes)</label>
              <input
                type="number"
                min="1"
                value={maxMinutes}
                onChange={(e) => setMaxMinutes(e.target.value ? parseInt(e.target.value, 10) : '')}
                placeholder="15"
                className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Given Prompt / Scenario Note */}
          <div>
            <label className="block text-gray-400 mb-1">User Given Situation / Prompt</label>
            <input
              type="text"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="e.g. If DOW tests excess low and prints hammer, enter long"
              className="w-full rounded-lg border border-surface-600 bg-surface-800 p-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* Session Horizon Checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="ltm-check"
              checked={isLongTerm}
              onChange={(e) => setIsLongTerm(e.target.checked)}
              className="rounded border-surface-600 bg-surface-800 text-brand-500 focus:ring-0"
            />
            <label htmlFor="ltm-check" className="text-gray-300">
              Long-Term Memory (persist across multiple sessions/days)
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-gray-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-bold transition shadow-sm"
            >
              Arm Situation
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


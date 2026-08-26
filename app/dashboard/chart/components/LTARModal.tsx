'use client'

import React, { useEffect, useState } from 'react'
import { LTARActivityRecord } from '@/lib/trading/ltarStore'

export function LTARModal({
    isOpen,
    onClose,
    instrument = 'DOW',
}: {
    isOpen: boolean
    onClose: () => void
    instrument?: string
}) {
    const [record, setRecord] = useState<LTARActivityRecord | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!isOpen) return
        setLoading(true)
        setError(null)
        fetch(`/api/trading/ltar?instrument=${encodeURIComponent(instrument)}`)
            .then((res) => res.json())
            .then((data) => {
                if (data.ok && data.record) {
                    setRecord(data.record)
                } else {
                    setError(data.error || 'Could not load LTAR record')
                }
            })
            .catch(() => setError('Failed to reach LTAR service'))
            .finally(() => setLoading(false))
    }, [isOpen, instrument])

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-3xl rounded-xl border border-amber-500/30 bg-[#12161f] p-6 text-gray-100 shadow-2xl shadow-amber-900/20 max-h-[90vh] overflow-y-auto font-sans">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-800 pb-4 mb-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300 uppercase border border-amber-500/40">
                                Figure 4.65 • LTAR
                            </span>
                            <h2 className="text-xl font-bold tracking-tight text-white">
                                Long-Term Activity Record
                            </h2>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 font-mono">
                            Market: <span className="text-amber-200 font-semibold">{record?.market || instrument}</span> · Date: <span className="text-amber-200 font-semibold">{record?.date || 'Today'}</span> · Pre-Open 9:30 AM Brief
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg bg-gray-800 p-2 text-gray-400 hover:bg-gray-700 hover:text-white transition"
                    >
                        ✕
                    </button>
                </div>

                {loading ? (
                    <div className="py-12 text-center text-amber-200 animate-pulse font-mono">
                        Generating 9:30 AM Long-Term Activity Record…
                    </div>
                ) : error ? (
                    <div className="py-8 text-center text-rose-300 font-mono">{error}</div>
                ) : record ? (
                    <div className="space-y-6">
                        {/* PART 1: ATTEMPTED DIRECTION */}
                        <div className="rounded-lg border border-gray-800 bg-[#181d28] p-4">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3 flex items-center justify-between">
                                <span>Part I: Attempted Direction</span>
                                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${record.attemptedDirection.overallAttemptedDirection === 'HIGHER'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : record.attemptedDirection.overallAttemptedDirection === 'LOWER'
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                        : 'bg-zinc-500/20 text-zinc-300 border border-zinc-500/40'
                                    }`}>
                                    Attempted Direction: {record.attemptedDirection.overallAttemptedDirection}
                                </span>
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div className="rounded bg-[#121620] p-2.5 border border-gray-800/80">
                                    <span className="text-gray-400">1. Rotation Factor Score:</span>{' '}
                                    <span className="font-mono font-bold text-amber-200">
                                        {record.attemptedDirection.rotationFactorScore > 0 ? '+' : ''}{record.attemptedDirection.rotationFactorScore} ({record.attemptedDirection.rotationFactorDir})
                                    </span>
                                </div>
                                <div className="rounded bg-[#121620] p-2.5 border border-gray-800/80">
                                    <span className="text-gray-400">2. Range Extension:</span>{' '}
                                    <span className="font-semibold text-gray-200">{record.attemptedDirection.rangeExtension}</span>
                                </div>
                                <div className="rounded bg-[#121620] p-2.5 border border-gray-800/80">
                                    <span className="text-gray-400">3. Structural Tails:</span>{' '}
                                    <span className="font-semibold text-gray-200">
                                        {record.attemptedDirection.tails.buyerTail ? '★ Buying Tail' : record.attemptedDirection.tails.sellerTail ? '★ Selling Tail' : 'None'}
                                    </span>
                                </div>
                                <div className="rounded bg-[#121620] p-2.5 border border-gray-800/80">
                                    <span className="text-gray-400">4. Buying/Selling Composite:</span>{' '}
                                    <span className="font-bold text-amber-200">{record.attemptedDirection.buyingSellingComposite}</span>
                                </div>
                            </div>
                            <div className="mt-3 text-xs text-gray-300 italic bg-amber-500/5 p-2 rounded border border-amber-500/20">
                                💬 Comments: {record.attemptedDirection.comments}
                            </div>
                        </div>

                        {/* PART 2: DIRECTIONAL PERFORMANCE */}
                        <div className="rounded-lg border border-gray-800 bg-[#181d28] p-4">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400 mb-3 flex items-center justify-between">
                                <span>Part II: Directional Performance (Trade Facilitation)</span>
                                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${record.directionalPerformance.performanceGrade === 'VERY_STRONG'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : record.directionalPerformance.performanceGrade === 'STRONG'
                                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                        : record.directionalPerformance.performanceGrade === 'SLOWING'
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    }`}>
                                    Perf Grade: {record.directionalPerformance.performanceGrade.replace(/_/g, ' ')}
                                </span>
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                                <div className="rounded bg-[#121620] p-2.5 border border-gray-800/80">
                                    <span className="text-gray-400 block mb-1">1. Relative Volume:</span>
                                    <span className="font-bold text-sky-200">{record.directionalPerformance.dailyVolumeVsAvg}</span>
                                </div>
                                <div className="rounded bg-[#121620] p-2.5 border border-gray-800/80">
                                    <span className="text-gray-400 block mb-1">2. Value-Area Placement:</span>
                                    <span className="font-bold text-amber-200">{record.directionalPerformance.valueAreaPlacement}</span>
                                </div>
                                <div className="rounded bg-[#121620] p-2.5 border border-gray-800/80">
                                    <span className="text-gray-400 block mb-1">3. Value-Area Width:</span>
                                    <span className="font-bold text-gray-200">{record.directionalPerformance.valueAreaWidth}</span>
                                </div>
                            </div>
                            <div className="mt-3 text-xs text-gray-300 italic bg-sky-500/5 p-2 rounded border border-sky-500/20">
                                💬 Comments: {record.directionalPerformance.comments}
                            </div>
                        </div>

                        {/* PART 3: EXPECTED RESULTS & PLAYBOOK DIRECTIVES */}
                        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-3">
                                Part III: Expected Playbook Directives & Target Scaling
                            </h3>

                            <div className="space-y-2.5 text-xs">
                                <div className="flex items-start gap-2">
                                    <span className="text-amber-400 font-bold">🏛️ Longer-Term Directive:</span>
                                    <span className="text-gray-200 font-medium">{record.expectedResults.longerTermDirective}</span>
                                </div>
                                <div className="flex items-start gap-2">
                                    <span className="text-sky-400 font-bold">⚡ Shorter-Term Directive:</span>
                                    <span className="text-gray-200 font-medium">{record.expectedResults.shorterTermDirective}</span>
                                </div>
                                <div className="mt-2 pt-2 border-t border-amber-500/20 text-xs font-mono text-amber-200">
                                    {record.expectedResults.summary}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {/* Footer */}
                <div className="mt-6 border-t border-gray-800 pt-4 flex justify-between items-center text-xs text-gray-400">
                    <span>Mind Over Markets • Long-Term Activity Record System</span>
                    <button
                        onClick={onClose}
                        className="rounded bg-amber-500/90 px-4 py-1.5 font-bold text-black hover:bg-amber-400 transition"
                    >
                        Close Briefing
                    </button>
                </div>
            </div>
        </div>
    )
}

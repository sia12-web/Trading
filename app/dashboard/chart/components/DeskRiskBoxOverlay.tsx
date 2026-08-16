'use client'

/**
 * Chart-attached SL / TP / entry pills — same drag UX as the live desk.
 * Used by simulation (and can be reused on live).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ISeriesApi } from 'lightweight-charts'
import { takeProfitFromStopR } from '@/lib/trading/positionSizing'
import { snapDeskPrice } from '@/lib/trading/instrumentTicks'
import { snapProfitToRound } from '@/lib/trading/deskLevels'
import {
  clampPriceToRangeEdgeEnvelope,
  snapEntryToNearestOpenBandCenter,
} from '@/lib/trading/rangeEdgeEntryGate'
import type { StrategyRangeEdges } from '@/lib/trading/strategyRiskGeometry'

export type DeskRiskBoxState = {
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  stopLoss: number
  profitTarget: number
  preferRangeLabel?: string | null
}

function priceFromPointer(
  container: HTMLElement | null,
  series: ISeriesApi<'Candlestick'> | null,
  clientY: number
): number | null {
  if (!container || !series) return null
  const rect = container.getBoundingClientRect()
  const y = clientY - rect.top
  if (y < 0 || y > rect.height) return null
  const raw = series.coordinateToPrice(y)
  if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return null
  return Number(raw)
}

function defaultManualStop(limit: number, direction: 'LONG' | 'SHORT'): number {
  const pct = 0.0035
  return direction === 'LONG' ? limit * (1 - pct) : limit * (1 + pct)
}

export function openDeskRiskBox(args: {
  entry: number
  direction: 'LONG' | 'SHORT'
  instrument: string
  preferRangeLabel?: string | null
}): DeskRiskBoxState {
  const sl = snapDeskPrice(args.instrument, defaultManualStop(args.entry, args.direction))
  const rawTp = takeProfitFromStopR({
    entry: args.entry,
    stop: sl,
    direction: args.direction,
  })
  return {
    direction: args.direction,
    entryPrice: args.entry,
    stopLoss: sl,
    profitTarget: snapDeskPrice(
      args.instrument,
      snapProfitToRound(args.entry, sl, rawTp, args.direction)
    ),
    preferRangeLabel: args.preferRangeLabel ?? null,
  }
}

export function DeskRiskBoxOverlay({
  containerRef,
  series,
  instrument,
  riskBox,
  onChange,
  onConfirm,
  onCancel,
  snapRanges,
  strategyRange,
  liveOk,
  riskDollars,
  fillsUsed,
  layoutTick,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  series: ISeriesApi<'Candlestick'> | null
  instrument: string
  riskBox: DeskRiskBoxState
  onChange: (next: DeskRiskBoxState) => void
  onConfirm: () => void
  onCancel: () => void
  snapRanges: StrategyRangeEdges[]
  strategyRange: StrategyRangeEdges | null
  liveOk: (range: StrategyRangeEdges) => boolean
  riskDollars: number
  fillsUsed: number
  layoutTick: number
}) {
  const draggingRef = useRef<'ENTRY' | 'TP' | 'SL' | null>(null)
  const boxRef = useRef(riskBox)
  boxRef.current = riskBox
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const snapRef = useRef({ snapRanges, strategyRange, liveOk })
  snapRef.current = { snapRanges, strategyRange, liveOk }

  const onMouseDown = useCallback(
    (type: 'ENTRY' | 'TP' | 'SL') => (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      draggingRef.current = type
    },
    []
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const type = draggingRef.current
      if (!type) return
      const raw = priceFromPointer(containerRef.current, series, e.clientY)
      if (raw == null) return
      const snappedRaw = snapDeskPrice(instrument, raw)
      const prev = boxRef.current

      if (type === 'ENTRY') {
        const enveloped = clampPriceToRangeEdgeEnvelope(snappedRaw, snapRef.current.snapRanges)
        const snapped = snapDeskPrice(instrument, enveloped ?? snappedRaw)
        const diff = snapped - prev.entryPrice
        onChangeRef.current({
          ...prev,
          entryPrice: snapped,
          stopLoss: snapDeskPrice(instrument, prev.stopLoss + diff),
          profitTarget: snapDeskPrice(instrument, prev.profitTarget + diff),
        })
        return
      }
      if (type === 'TP') {
        onChangeRef.current({ ...prev, profitTarget: snappedRaw })
        return
      }
      const isLong = prev.direction === 'LONG'
      if (isLong ? !(snappedRaw < prev.entryPrice) : !(snappedRaw > prev.entryPrice)) return
      const rawTp = takeProfitFromStopR({
        entry: prev.entryPrice,
        stop: snappedRaw,
        direction: prev.direction,
      })
      const tp = snapDeskPrice(
        instrument,
        snapProfitToRound(prev.entryPrice, snappedRaw, rawTp, prev.direction)
      )
      onChangeRef.current({ ...prev, stopLoss: snappedRaw, profitTarget: tp })
    }

    const onMouseUp = () => {
      const was = draggingRef.current
      draggingRef.current = null
      if (was !== 'ENTRY') return
      const { snapRanges: ranges, strategyRange: active, liveOk: ok } = snapRef.current
      const prev = boxRef.current
      const snapped = snapEntryToNearestOpenBandCenter({
        entry: prev.entryPrice,
        candidates: ranges,
        preferLabel: prev.preferRangeLabel ?? active?.label ?? null,
        liveOk: ok,
      })
      if (!snapped) return
      const next = snapDeskPrice(instrument, snapped.price)
      const preferRangeLabel =
        snapped.hit.range.label ?? prev.preferRangeLabel ?? active?.label ?? null
      if (next === prev.entryPrice && preferRangeLabel === prev.preferRangeLabel) return
      const diff = next - prev.entryPrice
      onChangeRef.current({
        ...prev,
        entryPrice: next,
        stopLoss: snapDeskPrice(instrument, prev.stopLoss + diff),
        profitTarget: snapDeskPrice(instrument, prev.profitTarget + diff),
        preferRangeLabel,
      })
    }

    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [containerRef, series, instrument])

  const toggleDirection = useCallback(() => {
    const prev = boxRef.current
    const newDir: 'LONG' | 'SHORT' = prev.direction === 'LONG' ? 'SHORT' : 'LONG'
    const slDist = Math.abs(prev.entryPrice - prev.stopLoss)
    const tpDist = Math.abs(prev.profitTarget - prev.entryPrice)
    onChange({
      ...prev,
      direction: newDir,
      stopLoss: snapDeskPrice(
        instrument,
        newDir === 'LONG' ? prev.entryPrice - slDist : prev.entryPrice + slDist
      ),
      profitTarget: snapDeskPrice(
        instrument,
        newDir === 'LONG' ? prev.entryPrice + tpDist : prev.entryPrice - tpDist
      ),
    })
  }, [instrument, onChange])

  const entryY = series ? series.priceToCoordinate(riskBox.entryPrice) : null
  const tpY = series ? series.priceToCoordinate(riskBox.profitTarget) : null
  const slY = series ? series.priceToCoordinate(riskBox.stopLoss) : null
  void layoutTick

  const slPts = Math.abs(riskBox.entryPrice - riskBox.stopLoss)
  const tpPts = Math.abs(riskBox.profitTarget - riskBox.entryPrice)
  const size = slPts > 0 ? riskDollars / slPts : 0
  const profitVal = size > 0 ? (size * tpPts).toFixed(0) : '—'
  const fillN = Math.min(fillsUsed + 1, 3)

  return (
    <div className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
      {tpY != null && (
        <div
          onMouseDown={onMouseDown('TP')}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
          style={{ left: '42%', top: `${tpY - 13}px` }}
          title="Drag Take Profit"
        >
          <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md group-hover:border-emerald-300 transition">
            <span className="text-emerald-400">+{profitVal}</span>
            <span className="text-emerald-600 mx-1.5">|</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
              className="text-gray-400 hover:text-emerald-200 transition font-bold"
              title="Cancel"
            >
              ✕
            </button>
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
        </div>
      )}

      {entryY != null && (
        <div
          onMouseDown={onMouseDown('ENTRY')}
          className="absolute flex items-center gap-2 pointer-events-auto cursor-ns-resize group"
          style={{ left: '32%', top: `${entryY - 14}px` }}
          title="Drag Entry between painted ±10 band centers"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onConfirm()
            }}
            className={`px-3 py-1 text-xs font-extrabold uppercase rounded-md shadow-md transition border ${
              riskBox.direction === 'LONG'
                ? 'bg-blue-600 border-blue-400 text-white hover:bg-blue-500 hover:scale-105'
                : 'bg-red-600 border-red-400 text-white hover:bg-red-500 hover:scale-105'
            }`}
            title={`Place ${riskBox.direction} limit`}
          >
            {riskBox.direction === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleDirection()
            }}
            className="w-7 h-7 flex items-center justify-center text-xs font-mono font-extrabold rounded-md shadow-md bg-[#161b22]/95 border border-gray-600 text-gray-200 hover:text-white hover:border-amber-400 transition"
            title={`Switch to ${riskBox.direction === 'LONG' ? 'SHORT' : 'LONG'}`}
          >
            ⇄
          </button>
          <div className="flex items-center rounded-md border border-blue-400 bg-white/95 px-3 py-1 text-xs font-mono font-bold text-gray-900 shadow-xl">
            <span className="font-sans uppercase font-extrabold tracking-wider text-[11px] select-none">
              Limit
            </span>
            <span className="text-gray-400 mx-1.5">|</span>
            <span className="text-[9px] font-sans uppercase tracking-wide text-sky-700">
              locked
            </span>
            <span className="text-gray-400 mx-1.5">|</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
              className="text-gray-400 hover:text-red-500 transition font-bold"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
          <div className="w-3 h-3 rounded-full border-2 border-white shadow-md bg-blue-500" />
        </div>
      )}

      {slY != null && (
        <div
          onMouseDown={onMouseDown('SL')}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
          style={{ left: '42%', top: `${slY - 13}px` }}
          title={`Drag Stop Loss — size keeps $${riskDollars} risk (fill ${fillN}/3)`}
        >
          <div className="flex items-center rounded border border-dashed border-amber-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-amber-300 shadow-md group-hover:border-amber-300 transition">
            <span className="text-amber-400">
              −${riskDollars} · fill {fillN}/3
            </span>
            <span className="text-amber-600 mx-1.5">|</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
              className="text-gray-400 hover:text-amber-200 transition font-bold"
              title="Cancel"
            >
              ✕
            </button>
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
        </div>
      )}
    </div>
  )
}

export function DeskWorkingBracketOverlay({
  containerRef,
  series,
  instrument,
  entry,
  direction,
  stopLoss,
  profitTarget,
  onTargetChange,
  layoutTick,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  series: ISeriesApi<'Candlestick'> | null
  instrument: string
  entry: number
  direction: 'LONG' | 'SHORT'
  stopLoss: number
  profitTarget: number
  onTargetChange: (target: number) => void
  layoutTick: number
}) {
  const draggingRef = useRef(false)
  const startRef = useRef(profitTarget)
  const draftRef = useRef(profitTarget)
  const [draft, setDraft] = useState(profitTarget)
  const onChangeRef = useRef(onTargetChange)
  onChangeRef.current = onTargetChange

  useEffect(() => {
    if (draggingRef.current) return
    setDraft(profitTarget)
    draftRef.current = profitTarget
  }, [profitTarget])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const raw = priceFromPointer(containerRef.current, series, e.clientY)
      if (raw == null) return
      const snapped = snapDeskPrice(instrument, raw)
      const isLong = direction === 'LONG'
      if (isLong ? !(snapped > entry) : !(snapped < entry)) return
      draftRef.current = snapped
      setDraft(snapped)
    }
    const onMouseUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (Math.abs(draftRef.current - startRef.current) > 1e-9) {
        onChangeRef.current(draftRef.current)
      }
    }
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [containerRef, series, instrument, direction, entry])

  const tpY = series ? series.priceToCoordinate(draft) : null
  const slY = series ? series.priceToCoordinate(stopLoss) : null
  void layoutTick

  return (
    <div className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
      {tpY != null && (
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            draggingRef.current = true
            startRef.current = draftRef.current
          }}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
          style={{ left: '48%', top: `${tpY - 13}px` }}
          title={`Drag Take Profit @ ${draft.toLocaleString()}`}
        >
          <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md">
            TP {draft.toLocaleString()}
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
        </div>
      )}
      {slY != null && (
        <div
          className="absolute flex items-center gap-1.5 pointer-events-none opacity-90"
          style={{ left: '48%', top: `${slY - 13}px` }}
          title="SL locked — sized at place"
        >
          <div className="flex items-center rounded border border-dotted border-red-500/60 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-red-300/90 shadow-md">
            SL {stopLoss.toLocaleString()}
            <span className="ml-1.5 text-[9px] font-sans uppercase tracking-wide text-amber-300/90">
              locked
            </span>
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/50 border border-white/40 shadow-sm" />
        </div>
      )}
    </div>
  )
}

export function DeskManageBracketOverlay({
  containerRef,
  series,
  instrument,
  entry,
  direction,
  stopLoss,
  profitTarget,
  size,
  onCommit,
  layoutTick,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  series: ISeriesApi<'Candlestick'> | null
  instrument: string
  entry: number
  direction: 'LONG' | 'SHORT'
  stopLoss: number
  profitTarget: number
  size: number
  onCommit: (next: { stopLoss: number; profitTarget: number }) => void
  layoutTick: number
}) {
  const draggingRef = useRef<'SL' | 'TP' | null>(null)
  const startRef = useRef({ stopLoss, profitTarget })
  const draftRef = useRef({ stopLoss, profitTarget })
  const [draft, setDraft] = useState({ stopLoss, profitTarget })
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => {
    if (draggingRef.current) return
    const next = { stopLoss, profitTarget }
    setDraft(next)
    draftRef.current = next
  }, [stopLoss, profitTarget])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const type = draggingRef.current
      if (!type) return
      const raw = priceFromPointer(containerRef.current, series, e.clientY)
      if (raw == null) return
      const snapped = snapDeskPrice(instrument, raw)
      const isLong = direction === 'LONG'
      if (type === 'SL') {
        if (isLong ? !(snapped < entry) : !(snapped > entry)) return
        const rawTp = takeProfitFromStopR({
          entry,
          stop: snapped,
          direction,
        })
        const tp = snapDeskPrice(instrument, snapProfitToRound(entry, snapped, rawTp, direction))
        const next = { stopLoss: snapped, profitTarget: tp }
        draftRef.current = next
        setDraft(next)
        return
      }
      if (isLong ? !(snapped > entry) : !(snapped < entry)) return
      const next = { ...draftRef.current, profitTarget: snapped }
      draftRef.current = next
      setDraft(next)
    }
    const onMouseUp = () => {
      const type = draggingRef.current
      draggingRef.current = null
      if (!type) return
      const cur = draftRef.current
      const start = startRef.current
      if (
        Math.abs(cur.stopLoss - start.stopLoss) < 1e-9 &&
        Math.abs(cur.profitTarget - start.profitTarget) < 1e-9
      ) {
        return
      }
      onCommitRef.current(cur)
    }
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [containerRef, series, instrument, direction, entry])

  const tpY = series ? series.priceToCoordinate(draft.profitTarget) : null
  const slY = series ? series.priceToCoordinate(draft.stopLoss) : null
  void layoutTick
  const units = Number.isFinite(size) && size > 0 ? size : 0
  const lossPts = Math.abs(entry - draft.stopLoss)
  const profitPts = Math.abs(draft.profitTarget - entry)
  const lossCad = units > 0 ? (units * lossPts).toFixed(0) : null
  const profitCad = units > 0 ? (units * profitPts).toFixed(0) : null

  return (
    <div className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
      {tpY != null && (
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            draggingRef.current = 'TP'
            startRef.current = draftRef.current
          }}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
          style={{ left: '48%', top: `${tpY - 13}px` }}
          title={`Drag Take Profit @ ${draft.profitTarget.toLocaleString()}`}
        >
          <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md">
            {profitCad != null ? `+${profitCad}` : `TP ${draft.profitTarget.toLocaleString()}`}
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
        </div>
      )}
      {slY != null && (
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            draggingRef.current = 'SL'
            startRef.current = draftRef.current
          }}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group"
          style={{ left: '48%', top: `${slY - 13}px` }}
          title={`Drag Stop Loss @ ${draft.stopLoss.toLocaleString()}`}
        >
          <div className="flex items-center rounded border border-dashed border-red-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-red-300 shadow-md">
            {lossCad != null ? `−${lossCad}` : `SL ${draft.stopLoss.toLocaleString()}`}
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-red-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
        </div>
      )}
    </div>
  )
}

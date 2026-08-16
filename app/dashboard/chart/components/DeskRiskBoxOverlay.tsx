'use client'

/**
 * Chart-attached SL / TP / entry pills — same drag UX as the live desk.
 * Used by simulation (and can be reused on live).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ISeriesApi } from 'lightweight-charts'
import { takeProfitFromStopR } from '@/lib/trading/positionSizing'
import { snapDeskPrice, snapStopToTick, snapTargetToTick } from '@/lib/trading/instrumentTicks'
import { snapProfitToRound } from '@/lib/trading/deskLevels'
import {
  overlayTopFromPrice,
  priceFromClientY,
  riskBoxDollarPreview,
} from '@/lib/chart/chartPointerPrice'
import { useStickySeriesLayout } from '@/app/dashboard/chart/components/useStickySeriesLayout'
import {
  clampPriceToRangeEdgeEnvelope,
  snapEntryToNearestOpenBandCenter,
  type RangeEdgeKind,
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
  return priceFromClientY(container, series, clientY)
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
  allowedEdges = null,
  lockDirection = false,
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
  /** CALL-legal ±10 edges. Null = all painted edges. */
  allowedEdges?: ReadonlyArray<RangeEdgeKind> | null
  /** When true, ⇄ cannot flip against the system CALL. */
  lockDirection?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<'ENTRY' | 'TP' | 'SL' | null>(null)
  const pendingYRef = useRef<number | null>(null)
  const rafRef = useRef(0)
  const boxRef = useRef(riskBox)
  boxRef.current = riskBox
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const snapRef = useRef({ snapRanges, strategyRange, liveOk, allowedEdges })
  snapRef.current = { snapRanges, strategyRange, liveOk, allowedEdges }
  const layoutTickSticky = useStickySeriesLayout(series, [
    riskBox.entryPrice,
    riskBox.stopLoss,
    riskBox.profitTarget,
  ])

  const onHandlePointerDown = useCallback(
    (type: 'ENTRY' | 'TP' | 'SL') => (e: React.PointerEvent) => {
      // Buttons (BUY / ✕ / ⇄) live on the same row — do not start a drag or
      // preventDefault, or the click never fires.
      if ((e.target as HTMLElement | null)?.closest('button')) return
      e.preventDefault()
      e.stopPropagation()
      draggingRef.current = type
      pendingYRef.current = e.clientY
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* capture optional */
      }
    },
    []
  )

  useEffect(() => {
    const applyY = (clientY: number) => {
      const type = draggingRef.current
      if (!type) return
      const raw = priceFromPointer(containerRef.current, series, clientY)
      if (raw == null) return
      const prev = boxRef.current

      if (type === 'ENTRY') {
        const enveloped = clampPriceToRangeEdgeEnvelope(
          snapDeskPrice(instrument, raw),
          snapRef.current.snapRanges,
          undefined,
          snapRef.current.allowedEdges
        )
        const snapped = snapDeskPrice(instrument, enveloped ?? raw)
        const diff = snapped - prev.entryPrice
        onChangeRef.current({
          ...prev,
          entryPrice: snapped,
          stopLoss: snapStopToTick(instrument, snapped, prev.stopLoss + diff, prev.direction),
          profitTarget: snapTargetToTick(
            instrument,
            snapped,
            prev.profitTarget + diff,
            prev.direction
          ),
        })
        return
      }
      if (type === 'TP') {
        const tp = snapTargetToTick(instrument, prev.entryPrice, raw, prev.direction)
        onChangeRef.current({ ...prev, profitTarget: tp })
        return
      }
      const sl = snapStopToTick(instrument, prev.entryPrice, raw, prev.direction)
      const isLong = prev.direction === 'LONG'
      if (isLong ? !(sl < prev.entryPrice) : !(sl > prev.entryPrice)) return
      const rawTp = takeProfitFromStopR({
        entry: prev.entryPrice,
        stop: sl,
        direction: prev.direction,
      })
      const tp = snapTargetToTick(
        instrument,
        prev.entryPrice,
        snapProfitToRound(prev.entryPrice, sl, rawTp, prev.direction),
        prev.direction
      )
      onChangeRef.current({ ...prev, stopLoss: sl, profitTarget: tp })
    }

    const flush = () => {
      rafRef.current = 0
      const y = pendingYRef.current
      if (y == null || !draggingRef.current) return
      applyY(y)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      pendingYRef.current = e.clientY
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(flush)
    }

    const onPointerUp = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const y = pendingYRef.current
      if (y != null && draggingRef.current) applyY(y)
      pendingYRef.current = null
      const was = draggingRef.current
      draggingRef.current = null
      if (was !== 'ENTRY') return
      const { snapRanges: ranges, strategyRange: active, liveOk: ok, allowedEdges } =
        snapRef.current
      const prev = boxRef.current
      const snapped = snapEntryToNearestOpenBandCenter({
        entry: prev.entryPrice,
        candidates: ranges,
        preferLabel: prev.preferRangeLabel ?? active?.label ?? null,
        liveOk: ok,
        allowedEdges,
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
        stopLoss: snapStopToTick(instrument, next, prev.stopLoss + diff, prev.direction),
        profitTarget: snapTargetToTick(
          instrument,
          next,
          prev.profitTarget + diff,
          prev.direction
        ),
        preferRangeLabel,
      })
    }

    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [containerRef, series, instrument])

  const toggleDirection = useCallback(() => {
    if (lockDirection) return
    const prev = boxRef.current
    const newDir: 'LONG' | 'SHORT' = prev.direction === 'LONG' ? 'SHORT' : 'LONG'
    const slDist = Math.abs(prev.entryPrice - prev.stopLoss)
    const tpDist = Math.abs(prev.profitTarget - prev.entryPrice)
    onChange({
      ...prev,
      direction: newDir,
      stopLoss: snapStopToTick(
        instrument,
        prev.entryPrice,
        newDir === 'LONG' ? prev.entryPrice - slDist : prev.entryPrice + slDist,
        newDir
      ),
      profitTarget: snapTargetToTick(
        instrument,
        prev.entryPrice,
        newDir === 'LONG' ? prev.entryPrice + tpDist : prev.entryPrice - tpDist,
        newDir
      ),
    })
  }, [instrument, onChange, lockDirection])

  const entryY = overlayTopFromPrice(
    series,
    riskBox.entryPrice,
    hostRef.current,
    containerRef.current
  )
  const tpY = overlayTopFromPrice(
    series,
    riskBox.profitTarget,
    hostRef.current,
    containerRef.current
  )
  const slY = overlayTopFromPrice(
    series,
    riskBox.stopLoss,
    hostRef.current,
    containerRef.current
  )
  void layoutTick
  void layoutTickSticky

  const dollars = riskBoxDollarPreview({
    entry: riskBox.entryPrice,
    stop: riskBox.stopLoss,
    target: riskBox.profitTarget,
    riskDollars,
  })
  const profitVal = dollars.size > 0 ? dollars.profitDollars.toFixed(0) : '—'
  const fillN = Math.min(fillsUsed + 1, 3)

  return (
    <div ref={hostRef} className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
      {tpY != null && (
        <div
          onPointerDown={onHandlePointerDown('TP')}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group touch-none select-none"
          style={{ left: '42%', top: `${tpY - 13}px` }}
          title={`Drag Take Profit @ ${riskBox.profitTarget.toLocaleString()}`}
        >
          <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md group-hover:border-emerald-300 transition">
            <span className="text-emerald-400">
              +{profitVal} · {riskBox.profitTarget.toLocaleString()}
            </span>
            <span className="text-emerald-600 mx-1.5">|</span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
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
          onPointerDown={onHandlePointerDown('ENTRY')}
          className="absolute flex items-center gap-2 pointer-events-auto cursor-ns-resize group touch-none select-none"
          style={{ left: '32%', top: `${entryY - 14}px` }}
          title={`Drag Entry @ ${riskBox.entryPrice.toLocaleString()} — ±10 band centers`}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
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
          {!lockDirection && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleDirection()
            }}
            className="w-7 h-7 flex items-center justify-center text-xs font-mono font-extrabold rounded-md shadow-md bg-[#161b22]/95 border border-gray-600 text-gray-200 hover:text-white hover:border-amber-400 transition"
            title={`Switch to ${riskBox.direction === 'LONG' ? 'SHORT' : 'LONG'}`}
          >
            ⇄
          </button>
          )}
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
              onPointerDown={(e) => e.stopPropagation()}
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
          onPointerDown={onHandlePointerDown('SL')}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group touch-none select-none"
          style={{ left: '42%', top: `${slY - 13}px` }}
          title={`Drag Stop Loss @ ${riskBox.stopLoss.toLocaleString()} — $${riskDollars} risk (fill ${fillN}/3)`}
        >
          <div className="flex items-center rounded border border-dashed border-amber-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-amber-300 shadow-md group-hover:border-amber-300 transition">
            <span className="text-amber-400">
              −${riskDollars} · {riskBox.stopLoss.toLocaleString()} · {fillN}/3
            </span>
            <span className="text-amber-600 mx-1.5">|</span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
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
  onCancel,
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
  onCancel?: () => void
  layoutTick: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const startRef = useRef(profitTarget)
  const draftRef = useRef(profitTarget)
  const pendingYRef = useRef<number | null>(null)
  const rafRef = useRef(0)
  const [draft, setDraft] = useState(profitTarget)
  const onChangeRef = useRef(onTargetChange)
  onChangeRef.current = onTargetChange
  const layoutTickSticky = useStickySeriesLayout(series, [entry, stopLoss, draft])

  useEffect(() => {
    if (draggingRef.current) return
    setDraft(profitTarget)
    draftRef.current = profitTarget
  }, [profitTarget])

  useEffect(() => {
    const applyY = (clientY: number) => {
      if (!draggingRef.current) return
      const raw = priceFromPointer(containerRef.current, series, clientY)
      if (raw == null) return
      const snapped = snapTargetToTick(instrument, entry, raw, direction)
      const isLong = direction === 'LONG'
      if (isLong ? !(snapped > entry) : !(snapped < entry)) return
      draftRef.current = snapped
      setDraft(snapped)
    }
    const flush = () => {
      rafRef.current = 0
      const y = pendingYRef.current
      if (y == null) return
      applyY(y)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      pendingYRef.current = e.clientY
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(flush)
    }
    const onPointerUp = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const y = pendingYRef.current
      if (y != null) applyY(y)
      pendingYRef.current = null
      if (!draggingRef.current) return
      draggingRef.current = false
      if (Math.abs(draftRef.current - startRef.current) > 1e-9) {
        onChangeRef.current(draftRef.current)
      }
    }
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [containerRef, series, instrument, direction, entry])

  const tpY = overlayTopFromPrice(series, draft, hostRef.current, containerRef.current)
  const slY = overlayTopFromPrice(series, stopLoss, hostRef.current, containerRef.current)
  void layoutTick
  void layoutTickSticky

  return (
    <div ref={hostRef} className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
      {tpY != null && (
        <div
          onPointerDown={(e) => {
            if ((e.target as HTMLElement | null)?.closest('button')) return
            e.preventDefault()
            e.stopPropagation()
            draggingRef.current = true
            startRef.current = draftRef.current
            pendingYRef.current = e.clientY
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* optional */
            }
          }}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group touch-none select-none"
          style={{ left: '48%', top: `${tpY - 13}px` }}
          title={`Drag Take Profit @ ${draft.toLocaleString()}`}
        >
          <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md">
            TP {draft.toLocaleString()}
            {onCancel && (
              <>
                <span className="text-emerald-600 mx-1.5">|</span>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancel()
                  }}
                  className="text-gray-400 hover:text-white transition font-bold"
                  title="Cancel working limit"
                >
                  ✕
                </button>
              </>
            )}
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
  const hostRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<'SL' | 'TP' | null>(null)
  const startRef = useRef({ stopLoss, profitTarget })
  const draftRef = useRef({ stopLoss, profitTarget })
  const pendingYRef = useRef<number | null>(null)
  const rafRef = useRef(0)
  const [draft, setDraft] = useState({ stopLoss, profitTarget })
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const layoutTickSticky = useStickySeriesLayout(series, [
    entry,
    draft.stopLoss,
    draft.profitTarget,
  ])

  useEffect(() => {
    if (draggingRef.current) return
    const next = { stopLoss, profitTarget }
    setDraft(next)
    draftRef.current = next
  }, [stopLoss, profitTarget])

  useEffect(() => {
    const applyY = (clientY: number) => {
      const type = draggingRef.current
      if (!type) return
      const raw = priceFromPointer(containerRef.current, series, clientY)
      if (raw == null) return
      const isLong = direction === 'LONG'
      if (type === 'SL') {
        const sl = snapStopToTick(instrument, entry, raw, direction)
        if (isLong ? !(sl < entry) : !(sl > entry)) return
        const rawTp = takeProfitFromStopR({
          entry,
          stop: sl,
          direction,
        })
        const tp = snapTargetToTick(
          instrument,
          entry,
          snapProfitToRound(entry, sl, rawTp, direction),
          direction
        )
        const next = { stopLoss: sl, profitTarget: tp }
        draftRef.current = next
        setDraft(next)
        return
      }
      const tp = snapTargetToTick(instrument, entry, raw, direction)
      if (isLong ? !(tp > entry) : !(tp < entry)) return
      const next = { ...draftRef.current, profitTarget: tp }
      draftRef.current = next
      setDraft(next)
    }
    const flush = () => {
      rafRef.current = 0
      const y = pendingYRef.current
      if (y == null) return
      applyY(y)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      pendingYRef.current = e.clientY
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(flush)
    }
    const onPointerUp = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      const y = pendingYRef.current
      if (y != null) applyY(y)
      pendingYRef.current = null
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
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [containerRef, series, instrument, direction, entry])

  const tpY = overlayTopFromPrice(
    series,
    draft.profitTarget,
    hostRef.current,
    containerRef.current
  )
  const slY = overlayTopFromPrice(series, draft.stopLoss, hostRef.current, containerRef.current)
  void layoutTick
  void layoutTickSticky
  const units = Number.isFinite(size) && size > 0 ? size : 0
  const lossPts = Math.abs(entry - draft.stopLoss)
  const profitPts = Math.abs(draft.profitTarget - entry)
  const lossCad = units > 0 ? (units * lossPts).toFixed(0) : null
  const profitCad = units > 0 ? (units * profitPts).toFixed(0) : null

  return (
    <div ref={hostRef} className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
      {tpY != null && (
        <div
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            draggingRef.current = 'TP'
            startRef.current = draftRef.current
            pendingYRef.current = e.clientY
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* optional */
            }
          }}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group touch-none select-none"
          style={{ left: '48%', top: `${tpY - 13}px` }}
          title={`Drag Take Profit @ ${draft.profitTarget.toLocaleString()}`}
        >
          <div className="flex items-center rounded border border-dashed border-emerald-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-300 shadow-md">
            {profitCad != null
              ? `+${profitCad} · ${draft.profitTarget.toLocaleString()}`
              : `TP ${draft.profitTarget.toLocaleString()}`}
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
        </div>
      )}
      {slY != null && (
        <div
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            draggingRef.current = 'SL'
            startRef.current = draftRef.current
            pendingYRef.current = e.clientY
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* optional */
            }
          }}
          className="absolute flex items-center gap-1.5 pointer-events-auto cursor-ns-resize group touch-none select-none"
          style={{ left: '48%', top: `${slY - 13}px` }}
          title={`Drag Stop Loss @ ${draft.stopLoss.toLocaleString()}`}
        >
          <div className="flex items-center rounded border border-dashed border-red-400/90 bg-[#161b22]/95 px-2.5 py-0.5 text-xs font-mono font-bold text-red-300 shadow-md">
            {lossCad != null
              ? `−${lossCad} · ${draft.stopLoss.toLocaleString()}`
              : `SL ${draft.stopLoss.toLocaleString()}`}
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-red-400 border border-white shadow-sm group-hover:scale-125 transition-transform" />
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * AtrSubPane — TradingView-style "Average True Range" indicator pane.
 *
 * - Exact TradingView math (see lib/chart/atrIndicator.ts): ta.tr(true) smoothed
 *   with RMA (default) / SMA / EMA / WMA, length 14, plot colour #B71C1C.
 * - Mirrors the main candle series 1:1 (same timestamps + whitespace) via
 *   `subscribeDataChanged`, so live ticks repaint the ATR instantly with
 *   `series.update()` — no full re-render of the big chart component.
 * - Lockstep zoom / pan with the price pane (logical-range sync) and a shared
 *   vertical crosshair across both panes, like TradingView multi-pane layouts.
 * - Legend with eye / settings / remove buttons, TradingView-like settings
 *   dialog (Inputs + Style tabs, live preview, Cancel reverts), draggable
 *   pane separator. Settings + pane height persist in localStorage.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts'
import { DESK_CHART_THEME } from '@/lib/chart/deskChartTheme'
import {
  ATR_SMOOTHING_OPTIONS,
  DEFAULT_ATR_SETTINGS,
  computeAtr,
  normalizeAtrSettings,
  type AtrSettings,
  type AtrSmoothing,
} from '@/lib/chart/atrIndicator'

const SETTINGS_KEY = 'desk.atr.settings.v1'
const HEIGHT_KEY = 'desk.atr.paneHeight.v1'
const DEFAULT_HEIGHT = 150
const MIN_HEIGHT = 70
const MAX_HEIGHT = 520

type RawBar = { time: Time; high?: number; low?: number; close?: number }

const timeKey = (t: Time): string => {
  if (typeof t === 'number') return String(t)
  if (typeof t === 'string') return t
  return `${t.year}-${t.month}-${t.day}`
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function loadSettings(): AtrSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_ATR_SETTINGS }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    return raw ? normalizeAtrSettings(JSON.parse(raw)) : { ...DEFAULT_ATR_SETTINGS }
  } catch {
    return { ...DEFAULT_ATR_SETTINGS }
  }
}

function loadHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_HEIGHT
  const h = Number(window.localStorage.getItem(HEIGHT_KEY))
  return Number.isFinite(h) && h >= MIN_HEIGHT && h <= MAX_HEIGHT ? h : DEFAULT_HEIGHT
}

function lastDefined(values: ReadonlyArray<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (v != null) return v
  }
  return null
}

interface AtrSubPaneProps {
  mainChart: IChartApi | null
  mainSeries: ISeriesApi<'Candlestick'> | null
  onClose: () => void
}

function AtrSubPaneImpl({ mainChart, mainSeries, onClose }: AtrSubPaneProps) {
  const [settings, setSettings] = useState<AtrSettings>(loadSettings)
  const [height, setHeight] = useState<number>(loadHeight)
  const [legend, setLegend] = useState<{ value: number | null; hovering: boolean }>({ value: null, hovering: false })
  const [precision, setPrecision] = useState(2)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const rawRef = useRef<ReadonlyArray<RawBar>>([])
  const valuesRef = useRef<Array<number | null>>([])
  const timesRef = useRef<Time[]>([])
  const indexByKeyRef = useRef<Map<string, number>>(new Map())
  const rebuildRef = useRef<(scope: 'full' | 'update') => void>(() => {})

  // Persist settings + height
  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {}
  }, [settings])
  useEffect(() => {
    try {
      window.localStorage.setItem(HEIGHT_KEY, String(Math.round(height)))
    } catch {}
  }, [height])

  // ── Create ATR chart & wire it to the main price pane ───────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !mainChart || !mainSeries) return

    const mainTs = mainChart.timeScale()
    const mainTsOpts = mainTs.options()
    let lastScaleWidth = 0
    try {
      lastScaleWidth = mainChart.priceScale('right').width()
    } catch {}

    const chart = createChart(container, {
      ...DESK_CHART_THEME,
      width: container.clientWidth || 800,
      height: container.clientHeight || height,
      rightPriceScale: {
        ...DESK_CHART_THEME.rightPriceScale,
        minimumWidth: Math.max(DESK_CHART_THEME.rightPriceScale.minimumWidth, lastScaleWidth),
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        ...DESK_CHART_THEME.timeScale,
        barSpacing: mainTsOpts.barSpacing,
        rightOffset: mainTsOpts.rightOffset,
        visible: false,
      },
      crosshair: {
        ...DESK_CHART_THEME.crosshair,
        horzLine: { ...DESK_CHART_THEME.crosshair.horzLine, visible: false, labelVisible: false },
      },
    })
    chartRef.current = chart

    const s = settingsRef.current
    const series = chart.addLineSeries({
      color: s.color,
      lineWidth: s.lineWidth,
      visible: s.visible,
      lastValueVisible: s.showLastValueLabel,
      priceLineVisible: s.showPriceLine,
      priceLineWidth: 1,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    seriesRef.current = series

    // Pointer / hover tracking — decides which pane "owns" scroll + crosshair.
    let hovering = false
    let pointerDown = false
    let currentPrecision = -1

    // ── Data: mirror main candle series and compute ATR ──
    const point = (t: Time, v: number | null): LineData | WhitespaceData =>
      v == null ? { time: t } : { time: t, value: v }

    const rebuild = (scope: 'full' | 'update') => {
      let raw: ReadonlyArray<RawBar>
      try {
        raw = mainSeries.data() as ReadonlyArray<RawBar>
      } catch {
        return
      }
      const cfg = settingsRef.current
      const values = computeAtr(raw, cfg.length, cfg.smoothing)
      const n = raw.length
      const prevTimes = timesRef.current
      const prevN = prevTimes.length

      // Match the instrument's tick precision (TradingView ATR uses symbol format)
      try {
        const pf = mainSeries.options().priceFormat as { precision?: number }
        const p = isNum(pf?.precision) ? Math.max(0, Math.min(8, pf.precision)) : 2
        if (p !== currentPrecision) {
          currentPrecision = p
          series.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: 1 / 10 ** p } })
          setPrecision(p)
        }
      } catch {}

      const prevTip = prevN > 0 ? raw[prevN - 1] : undefined
      const prevTipTime = prevN > 0 ? prevTimes[prevN - 1] : undefined
      const incremental =
        scope === 'update' &&
        prevN > 0 &&
        (n === prevN || n === prevN + 1) &&
        prevTip != null &&
        prevTipTime != null &&
        timeKey(prevTip.time) === timeKey(prevTipTime)

      rawRef.current = raw
      valuesRef.current = values

      const tip = n > 0 ? raw[n - 1] : undefined
      if (incremental && tip) {
        if (n === prevN + 1) {
          prevTimes.push(tip.time)
          indexByKeyRef.current.set(timeKey(tip.time), n - 1)
        }
        try {
          series.update(point(tip.time, values[n - 1] ?? null))
        } catch {
          rebuild('full')
          return
        }
      } else {
        const times: Time[] = new Array(n)
        const map = new Map<string, number>()
        const data: Array<LineData | WhitespaceData> = new Array(n)
        for (let i = 0; i < n; i++) {
          const t = (raw[i] as RawBar).time
          times[i] = t
          map.set(timeKey(t), i)
          data[i] = point(t, values[i] ?? null)
        }
        timesRef.current = times
        indexByKeyRef.current = map
        try {
          series.setData(data)
        } catch {}
        syncFromMain()
      }

      if (!hovering) {
        setLegend((prev) => {
          const v = lastDefined(values)
          return prev.value === v && !prev.hovering ? prev : { value: v, hovering: false }
        })
      }
    }
    rebuildRef.current = rebuild

    // rAF-batched data change listener (bursty live feeds → one repaint per frame)
    let dataRaf = 0
    let pendingScope: 'full' | 'update' | null = null
    const onDataChanged = (scope: 'full' | 'update') => {
      pendingScope = pendingScope === 'full' || scope === 'full' ? 'full' : 'update'
      if (dataRaf) return
      dataRaf = requestAnimationFrame(() => {
        dataRaf = 0
        const sc = pendingScope ?? 'full'
        pendingScope = null
        rebuild(sc)
      })
    }
    mainSeries.subscribeDataChanged(onDataChanged)

    // ── Time-axis lockstep (logical range) + price-axis width alignment ──
    function syncFromMain() {
      const r = mainTs.getVisibleLogicalRange()
      if (r) {
        const cur = chart.timeScale().getVisibleLogicalRange()
        if (!cur || Math.abs(cur.from - r.from) > 0.001 || Math.abs(cur.to - r.to) > 0.001) {
          try {
            chart.timeScale().setVisibleLogicalRange(r)
          } catch {}
        }
      }
      try {
        const w = mainChart!.priceScale('right').width()
        if (w > 0 && Math.abs(w - lastScaleWidth) >= 1) {
          lastScaleWidth = w
          chart.applyOptions({ rightPriceScale: { minimumWidth: w } })
        }
      } catch {}
    }
    const onMainRange = () => {
      if (hovering || pointerDown) return
      syncFromMain()
    }
    const onAtrRange = () => {
      if (!hovering && !pointerDown) return
      const r = chart.timeScale().getVisibleLogicalRange()
      if (!r) return
      const cur = mainTs.getVisibleLogicalRange()
      if (cur && Math.abs(cur.from - r.from) <= 0.001 && Math.abs(cur.to - r.to) <= 0.001) return
      try {
        mainTs.setVisibleLogicalRange(r)
      } catch {}
    }
    mainTs.subscribeVisibleLogicalRangeChange(onMainRange)
    chart.timeScale().subscribeVisibleLogicalRangeChange(onAtrRange)

    // ── Shared crosshair ──
    let legendRaf = 0
    let pendingLegend: { value: number | null; hovering: boolean } | null = null
    const pushLegend = (value: number | null, isHover: boolean) => {
      pendingLegend = { value, hovering: isHover }
      if (legendRaf) return
      legendRaf = requestAnimationFrame(() => {
        legendRaf = 0
        const next = pendingLegend
        pendingLegend = null
        if (next) setLegend((prev) => (prev.value === next.value && prev.hovering === next.hovering ? prev : next))
      })
    }
    const valueAt = (t: Time): { idx: number | undefined; v: number | null } => {
      const idx = indexByKeyRef.current.get(timeKey(t))
      return { idx, v: idx != null ? valuesRef.current[idx] ?? null : null }
    }

    const onMainCrosshair = (p: MouseEventParams) => {
      if (hovering) return
      if (!p.time || !p.point) {
        chart.clearCrosshairPosition()
        pushLegend(lastDefined(valuesRef.current), false)
        return
      }
      const { v } = valueAt(p.time)
      const anchor = v ?? lastDefined(valuesRef.current)
      if (anchor != null) {
        try {
          chart.setCrosshairPosition(anchor, p.time, series)
        } catch {}
      }
      pushLegend(v, true)
    }
    const onAtrCrosshair = (p: MouseEventParams) => {
      if (!hovering) return
      if (!p.time || !p.point) {
        try {
          mainChart.clearCrosshairPosition()
        } catch {}
        pushLegend(lastDefined(valuesRef.current), false)
        return
      }
      const { idx, v } = valueAt(p.time)
      const close = idx != null ? rawRef.current[idx]?.close : undefined
      if (isNum(close)) {
        try {
          mainChart.setCrosshairPosition(close, p.time, mainSeries)
        } catch {}
      }
      pushLegend(v, true)
    }
    mainChart.subscribeCrosshairMove(onMainCrosshair)
    chart.subscribeCrosshairMove(onAtrCrosshair)

    // Horizontal crosshair line only on the hovered pane (TradingView behaviour)
    const onEnter = () => {
      hovering = true
      try {
        mainChart.applyOptions({ crosshair: { horzLine: { visible: false, labelVisible: false } } })
        chart.applyOptions({ crosshair: { horzLine: { visible: true, labelVisible: true } } })
      } catch {}
    }
    const onLeave = () => {
      hovering = false
      try {
        mainChart.clearCrosshairPosition()
        mainChart.applyOptions({ crosshair: { horzLine: { visible: true, labelVisible: true } } })
        chart.applyOptions({ crosshair: { horzLine: { visible: false, labelVisible: false } } })
      } catch {}
      if (!pointerDown) syncFromMain()
      pushLegend(lastDefined(valuesRef.current), false)
    }
    const onDown = () => {
      pointerDown = true
    }
    const onUp = () => {
      if (!pointerDown) return
      pointerDown = false
      // kinetic scroll may still be settling — re-align once it ends
      setTimeout(() => {
        if (!hovering && !pointerDown) syncFromMain()
      }, 450)
    }
    container.addEventListener('mouseenter', onEnter)
    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    // Resize with the pane / window
    let lastW = 0
    let lastH = 0
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w < 1 || h < 1 || (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1)) return
      lastW = w
      lastH = h
      chart.resize(w, h)
      requestAnimationFrame(syncFromMain)
    })
    ro.observe(container)

    rebuild('full')
    requestAnimationFrame(syncFromMain)

    return () => {
      ro.disconnect()
      container.removeEventListener('mouseenter', onEnter)
      container.removeEventListener('mouseleave', onLeave)
      container.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      if (dataRaf) cancelAnimationFrame(dataRaf)
      if (legendRaf) cancelAnimationFrame(legendRaf)
      try {
        mainSeries.unsubscribeDataChanged(onDataChanged)
      } catch {}
      try {
        mainTs.unsubscribeVisibleLogicalRangeChange(onMainRange)
      } catch {}
      try {
        mainChart.unsubscribeCrosshairMove(onMainCrosshair)
        mainChart.applyOptions({ crosshair: { horzLine: { visible: true, labelVisible: true } } })
      } catch {}
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      rebuildRef.current = () => {}
      timesRef.current = []
      indexByKeyRef.current = new Map()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainChart, mainSeries])

  // ── Apply settings live (TradingView previews edits while the dialog is open) ──
  const prevCalcRef = useRef({ length: settings.length, smoothing: settings.smoothing })
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.applyOptions({
      color: settings.color,
      lineWidth: settings.lineWidth,
      visible: settings.visible,
      lastValueVisible: settings.showLastValueLabel,
      priceLineVisible: settings.showPriceLine,
      priceLineColor: settings.color,
    })
    const prev = prevCalcRef.current
    if (prev.length !== settings.length || prev.smoothing !== settings.smoothing) {
      prevCalcRef.current = { length: settings.length, smoothing: settings.smoothing }
      rebuildRef.current('full')
    }
  }, [settings])

  // ── Draggable pane separator ──
  const onResizerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startY = e.clientY
      const startH = height
      let raf = 0
      let nextH = startH
      const move = (ev: PointerEvent) => {
        nextH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startH + (startY - ev.clientY)))
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          setHeight(nextH)
        })
      }
      const up = () => {
        if (raf) cancelAnimationFrame(raf)
        setHeight(nextH)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'ns-resize'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [height]
  )

  const valueText =
    legend.value == null ? '∅' : legend.value.toFixed(precision)

  return (
    <div
      className="relative w-full flex-shrink-0 border-t border-zinc-800 bg-[#0e1117] select-none text-zinc-200"
      style={{ height }}
      onClick={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      {/* Pane separator — drag to resize (TradingView style) */}
      <div
        onPointerDown={onResizerDown}
        onDoubleClick={() => setHeight(DEFAULT_HEIGHT)}
        className="group absolute -top-[5px] left-0 right-0 z-30 h-[9px] cursor-ns-resize"
        title="Drag to resize ATR pane · double-click to reset"
      >
        <div className="mx-auto mt-[4px] h-px w-full bg-transparent transition-colors group-hover:bg-cyan-500 group-active:bg-cyan-400" />
      </div>

      {/* Legend (TradingView indicator status line) */}
      <div className="group/legend absolute left-2 top-1.5 z-20 flex items-center gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-950/90 px-2 py-0.5 text-[12px] leading-none hover:bg-zinc-900 shadow-md">
        <span
          className={`cursor-pointer font-semibold ${settings.visible ? 'text-zinc-200' : 'text-zinc-500'}`}
          onDoubleClick={() => setSettingsOpen(true)}
          title="Double-click to open settings"
        >
          ATR <span className={settings.visible ? 'text-zinc-400' : 'text-zinc-600'}>{settings.length} {settings.smoothing}</span>
        </span>
        <span
          className="font-mono tabular-nums font-bold"
          style={{ color: settings.visible ? settings.color : '#6b7280' }}
        >
          {valueText}
        </span>
        <div className="ml-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/legend:opacity-100">
          <LegendButton
            title={settings.visible ? 'Hide' : 'Show'}
            onClick={() => setSettings((s) => ({ ...s, visible: !s.visible }))}
          >
            {settings.visible ? <EyeIcon /> : <EyeOffIcon />}
          </LegendButton>
          <LegendButton title="Settings" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </LegendButton>
          <LegendButton title="Remove" onClick={onClose}>
            <CloseIcon />
          </LegendButton>
        </div>
      </div>

      <div ref={containerRef} className="absolute inset-0 z-0" />

      {settingsOpen && (
        <AtrSettingsDialog
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

export const AtrSubPane = memo(AtrSubPaneImpl)
export default AtrSubPane

// ── Settings dialog (TradingView "ATR" settings) ───────────────────────────────

function AtrSettingsDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: AtrSettings
  onChange: (s: AtrSettings) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'inputs' | 'style'>('inputs')
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const snapshotRef = useRef(settings)
  const [lengthDraft, setLengthDraft] = useState(String(settings.length))

  const cancel = useCallback(() => {
    onChange(snapshotRef.current)
    onClose()
  }, [onChange, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancel()
      } else if (e.key === 'Enter') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cancel, onClose])

  const patch = (p: Partial<AtrSettings>) => onChange(normalizeAtrSettings({ ...settings, ...p }))

  const commitLength = (raw: string) => {
    setLengthDraft(raw)
    const n = Math.floor(Number(raw))
    if (Number.isFinite(n) && n >= 1) patch({ length: n })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="w-[380px] rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="text-[16px] font-bold text-white">ATR Settings</span>
          <button type="button" onClick={cancel} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition" title="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="flex gap-5 border-b border-zinc-800 px-5 text-[13px] font-semibold">
          {(['inputs', 'style'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 pb-2 capitalize transition-colors ${
                tab === t ? 'border-blue-500 text-blue-400 font-bold' : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-4 px-5 py-5 text-[13px]">
          {tab === 'inputs' ? (
            <>
              <Row label="Length">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={lengthDraft}
                  onChange={(e) => commitLength(e.target.value)}
                  onBlur={() => setLengthDraft(String(settings.length))}
                  className="h-[34px] w-[150px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-white outline-none focus:border-blue-500 font-mono text-sm"
                  autoFocus
                />
              </Row>
              <Row label="Smoothing">
                <select
                  value={settings.smoothing}
                  onChange={(e) => patch({ smoothing: e.target.value as AtrSmoothing })}
                  className="h-[34px] w-[150px] rounded-lg border border-zinc-700 bg-zinc-950 text-white px-3 outline-none focus:border-blue-500 cursor-pointer font-mono text-sm"
                >
                  {ATR_SMOOTHING_OPTIONS.map((o) => (
                    <option key={o} value={o} className="bg-zinc-900 text-white">
                      {o}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-zinc-200 font-medium">
                  <input
                    type="checkbox"
                    checked={settings.visible}
                    onChange={(e) => patch({ visible: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-blue-600"
                  />
                  ATR Line
                </label>
                <div className="flex items-center gap-2">
                  <label
                    className="relative h-[30px] w-[30px] cursor-pointer overflow-hidden rounded-md border border-zinc-700 shadow-sm"
                    title="Colour"
                    style={{ backgroundColor: settings.color }}
                  >
                    <input
                      type="color"
                      value={settings.color}
                      onChange={(e) => patch({ color: e.target.value })}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <select
                    value={settings.lineWidth}
                    onChange={(e) => patch({ lineWidth: Number(e.target.value) as AtrSettings['lineWidth'] })}
                    className="h-[30px] rounded-md border border-zinc-700 bg-zinc-950 text-white px-2 text-[12px] outline-none focus:border-blue-500 cursor-pointer font-mono"
                    title="Line thickness"
                  >
                    {[1, 2, 3, 4].map((w) => (
                      <option key={w} value={w} className="bg-zinc-900 text-white">
                        {w}px
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="border-t border-zinc-800 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Outputs
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-zinc-300 text-xs">
                <input
                  type="checkbox"
                  checked={settings.showLastValueLabel}
                  onChange={(e) => patch({ showLastValueLabel: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-blue-600"
                />
                Labels on price scale
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-zinc-300 text-xs">
                <input
                  type="checkbox"
                  checked={settings.showPriceLine}
                  onChange={(e) => patch({ showPriceLine: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-blue-600"
                />
                Price line
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3 bg-zinc-950/50">
          <div className="relative">
            <button
              type="button"
              onClick={() => setDefaultsOpen((o) => !o)}
              className="flex h-[32px] items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
            >
              Defaults <span className="text-[10px]">▾</span>
            </button>
            {defaultsOpen && (
              <div className="absolute bottom-[38px] left-0 w-[160px] rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-[13px] shadow-xl z-10 text-zinc-200">
                <button
                  type="button"
                  onClick={() => {
                    onChange({ ...DEFAULT_ATR_SETTINGS })
                    setLengthDraft(String(DEFAULT_ATR_SETTINGS.length))
                    setDefaultsOpen(false)
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800 text-zinc-300 hover:text-white transition"
                >
                  Reset settings
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              className="h-[32px] rounded-lg border border-zinc-700 px-4 text-[12px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-[32px] rounded-lg bg-blue-600 px-5 text-[12px] font-semibold text-white hover:bg-blue-500 transition shadow-sm"
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      {children}
    </div>
  )
}

function LegendButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
    >
      {children}
    </button>
  )
}

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M1.5 9s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" />
    <circle cx="9" cy="9" r="2.3" />
  </svg>
)
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M1.5 9s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" />
    <path d="M3 15 15 3" />
  </svg>
)
const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
    <circle cx="9" cy="9" r="2.3" />
    <path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4" />
  </svg>
)
const CloseIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" />
  </svg>
)

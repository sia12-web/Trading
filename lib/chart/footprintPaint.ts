/**
 * Sierra / Tradovate number-bar footprint.
 * Bid (hit the bid) left in red, ask (lifted the offer) right in green.
 * Diagonal imbalance (ask at P vs bid at P−1 tick) at 300%.
 * Only the recent live bars — never a historical tape dump.
 */

import type { FootprintBar } from '@/lib/trading/orderFlowDelta'
import { aggregateFootprintTicks } from '@/lib/trading/orderFlowDelta'

export const FOOTPRINT_RECENT_BARS = 12
export const FOOTPRINT_BAR_SPACING = 32
export const FOOTPRINT_IMBALANCE_RATIO = 3

export function deskFootprintTickSize(instrument: string): number {
  if (instrument === 'DOW') return 1
  if (instrument === 'GOLD') return 0.1
  if (instrument === 'CRUDE') return 0.01
  return 0.25
}

export function recentFootprintSlice<T>(bars: T[], n = FOOTPRINT_RECENT_BARS): T[] {
  if (bars.length <= n) return bars
  return bars.slice(-n)
}

export function paintSierraNumberBars(
  ctx: CanvasRenderingContext2D,
  args: {
    bars: FootprintBar[]
    paneW: number
    paneH: number
    timeToX: (time: number) => number | null
    priceToY: (price: number) => number | null
    barSpacing: number
  }
): void {
  const { bars, paneW, paneH, timeToX, priceToY, barSpacing } = args
  if (bars.length === 0 || paneW < 10 || paneH < 10) return

  const barBodyW = Math.min(118, Math.max(52, barSpacing * 0.9))

  for (const bar of bars) {
    const x = timeToX(bar.time)
    if (x == null || !Number.isFinite(x) || x < -barBodyW || x > paneW + barBodyW) continue

    const yHigh = priceToY(bar.high)
    const yLow = priceToY(bar.low)
    if (yHigh == null || yLow == null) continue

    const topY = Math.min(yHigh, yLow)
    const botY = Math.max(yHigh, yLow)
    const bodyLeft = x - barBodyW / 2
    const midX = bodyLeft + barBodyW / 2
    const candleH = Math.max(12, botY - topY)

    ctx.save()
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)'
    ctx.fillRect(bodyLeft, topY, barBodyW, candleH)
    ctx.strokeStyle = bar.close >= bar.open ? 'rgba(16, 185, 129, 0.55)' : 'rgba(244, 63, 94, 0.55)'
    ctx.lineWidth = 1
    ctx.strokeRect(bodyLeft + 0.5, topY + 0.5, barBodyW - 1, candleH - 1)

    if (topY > 28) {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace'
      ctx.fillStyle = '#93c5fd'
      ctx.fillText(bar.totalVolume.toLocaleString(), x, topY - 12)
      ctx.fillStyle = bar.netDelta >= 0 ? '#34d399' : '#f87171'
      const deltaTxt = `${bar.netDelta >= 0 ? '+' : ''}${bar.netDelta.toLocaleString()}`
      ctx.fillText(deltaTxt, x, topY - 1)
    }

    if (bar.ticks.length === 0) {
      ctx.restore()
      continue
    }

    const maxBuckets = Math.max(1, Math.floor(candleH / 12))
    const rows = aggregateFootprintTicks(bar.ticks, maxBuckets)
    let maxVol = 1
    let pocIdx = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!
      if (r.totalVol > maxVol) {
        maxVol = r.totalVol
        pocIdx = i
      }
    }

    ctx.textBaseline = 'middle'
    ctx.font = `bold ${candleH / rows.length >= 16 ? 10 : 9}px ui-monospace, SFMono-Regular, monospace`

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!
      const yTop = priceToY(r.highPrice)
      const yBot = priceToY(r.lowPrice)
      if (yTop == null || yBot == null) continue
      const rowY = (yTop + yBot) / 2
      const rowH = Math.max(11, Math.abs(yBot - yTop) - 0.5)
      if (rowY < -16 || rowY > paneH + 16) continue

      const cellTop = rowY - rowH / 2
      const half = (barBodyW - 2) / 2
      const bidLeft = bodyLeft + 1
      const askLeft = midX

      if (i === pocIdx) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.28)'
        ctx.fillRect(bodyLeft + 1, cellTop, barBodyW - 2, rowH)
        ctx.strokeStyle = '#facc15'
        ctx.lineWidth = 1
        ctx.strokeRect(bodyLeft + 1.5, cellTop + 0.5, barBodyW - 3, rowH - 1)
      }

      if (r.isSellImbalance) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.38)'
        ctx.fillRect(bidLeft, cellTop, half, rowH)
      }
      if (r.isBuyImbalance) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.38)'
        ctx.fillRect(askLeft, cellTop, half, rowH)
      }

      ctx.textAlign = 'right'
      ctx.fillStyle = r.isSellImbalance ? '#fecaca' : '#f87171'
      ctx.fillText(String(r.bidVol), bidLeft + half - 3, rowY)

      ctx.textAlign = 'center'
      ctx.fillStyle = '#64748b'
      ctx.fillText('x', midX, rowY)

      ctx.textAlign = 'left'
      ctx.fillStyle = r.isBuyImbalance ? '#bbf7d0' : '#34d399'
      ctx.fillText(String(r.askVol), askLeft + 4, rowY)
    }

    ctx.restore()
  }
}

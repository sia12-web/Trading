'use client'

import { useEffect, useRef, useState } from 'react'
import { seriesLayoutKey } from '@/lib/chart/chartPointerPrice'

/** How long to keep sampling every frame after the last interaction. */
const SETTLE_MS = 350
/** Streaming candles re-autoscale with no input event — cheap safety net. */
const IDLE_POLL_MS = 250

/**
 * Re-render when the series maps the given prices to new pixel Y
 * (vertical zoom, autoscale, resize, fullscreen). Frame sampling only runs
 * while the chart is being touched; idle pages fall back to a slow poll.
 */
export function useStickySeriesLayout(
  series: { priceToCoordinate: (price: number) => number | null } | null,
  prices: number[]
): number {
  const pricesRef = useRef(prices)
  pricesRef.current = prices
  const [tick, setTick] = useState(0)
  const active = prices.length > 0

  useEffect(() => {
    if (!series || !active) return
    let last = ''
    let raf = 0
    let sampleUntil = 0

    const check = () => {
      const key = seriesLayoutKey(series, pricesRef.current)
      if (key !== last) {
        last = key
        setTick((n) => n + 1)
      }
    }

    const loop = () => {
      check()
      if (Date.now() < sampleUntil) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = 0
      }
    }

    const poke = () => {
      sampleUntil = Date.now() + SETTLE_MS
      if (raf) return
      raf = requestAnimationFrame(loop)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) poke()
    }

    const listen = { passive: true, capture: true } as const
    window.addEventListener('wheel', poke, listen)
    window.addEventListener('pointerdown', poke, listen)
    window.addEventListener('pointermove', onPointerMove, listen)
    window.addEventListener('pointerup', poke, listen)
    window.addEventListener('touchmove', poke, listen)
    window.addEventListener('resize', poke)
    document.addEventListener('fullscreenchange', poke)
    const idle = window.setInterval(check, IDLE_POLL_MS)

    poke()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.clearInterval(idle)
      window.removeEventListener('wheel', poke, listen)
      window.removeEventListener('pointerdown', poke, listen)
      window.removeEventListener('pointermove', onPointerMove, listen)
      window.removeEventListener('pointerup', poke, listen)
      window.removeEventListener('touchmove', poke, listen)
      window.removeEventListener('resize', poke)
      document.removeEventListener('fullscreenchange', poke)
    }
  }, [series, active])

  return tick
}

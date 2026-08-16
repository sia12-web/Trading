'use client'

import { useEffect, useRef, useState } from 'react'
import { seriesLayoutKey } from '@/lib/chart/chartPointerPrice'

/**
 * Re-render when the series maps the given prices to new pixel Y
 * (vertical zoom, autoscale, resize, fullscreen). Idle frames are free.
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
    const loop = () => {
      const key = seriesLayoutKey(series, pricesRef.current)
      if (key !== last) {
        last = key
        setTick((n) => n + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [series, active])

  return tick
}

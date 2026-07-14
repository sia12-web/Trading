'use client'

/**
 * Real-Time Price Chart Component
 * Uses lightweight-charts library for TradingView-style visualization
 * Displays live price action with support/resistance levels
 */

import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType } from 'lightweight-charts'
import type { PositionStatus } from '@/types/positionManagement'

interface PriceChartProps {
  position: PositionStatus | null
  currentPrice: number | null
}

export function PriceChart({ position, currentPrice }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const lineSeriesRef = useRef<any>(null)
  const [priceHistory, setPriceHistory] = useState<Array<{ time: string; value: number }>>([])

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1e1e1e' },
        textColor: '#d1d5db',
      },
      width: containerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    })

    chartRef.current = chart

    const lineSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
    })
    lineSeriesRef.current = lineSeries

    // Add entry price line
    if (position) {
      const now = Math.floor(Date.now() / 1000)
      chart.addLineSeries({
        color: '#10b981',
        lineWidth: 1,
      }).setData([
        { time: (now - 600) as any, value: position.entry_price },
        { time: now as any, value: position.entry_price },
      ])

      // Add stop loss line
      chart.addLineSeries({
        color: '#ef4444',
        lineWidth: 1,
      }).setData([
        { time: (now - 600) as any, value: position.stop_loss_price },
        { time: now as any, value: position.stop_loss_price },
      ])

      // Add profit target line
      chart.addLineSeries({
        color: '#06b6d4',
        lineWidth: 1,
      }).setData([
        { time: (now - 600) as any, value: position.profit_target_price },
        { time: now as any, value: position.profit_target_price },
      ])
    }

    chart.timeScale().fitContent()

    const handleResize = () => {
      if (containerRef.current && chart) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [position])

  // Update price data
  useEffect(() => {
    if (!lineSeriesRef.current || !currentPrice) return

    const time = Math.floor(Date.now() / 1000)
    const newData = [...priceHistory, { time: time.toString(), value: currentPrice }]

    // Keep only last 200 points
    if (newData.length > 200) {
      newData.shift()
    }

    setPriceHistory(newData)
    lineSeriesRef.current.setData(
      newData.map((d) => ({
        time: parseInt(d.time),
        value: d.value,
      }))
    )

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent()
    }
  }, [currentPrice, priceHistory])

  if (!position) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        <p>No position open - chart unavailable</p>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-gray-300">Live Price Chart</h3>
        <div className="flex gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-gray-400">Entry: ${position.entry_price.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-gray-400">SL: ${position.stop_loss_price.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-cyan-500" />
            <span className="text-gray-400">Target: ${position.profit_target_price.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '400px' }} />
    </div>
  )
}

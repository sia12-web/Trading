'use client'

import React, { useEffect, useRef, memo } from 'react'
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts'
import type { PricePoint } from '@/lib/services/priceHistoryManager'

interface LevelData {
  level: number
  status: string
  proximity: string
}

interface PriceChartProps {
  priceHistory: PricePoint[]
  levels: LevelData[]
  accentColor: string
  height?: number
}

const getLevelColor = (status: string): string => {
  const colors: Record<string, string> = {
    unvisited: '#6b7280',   // gray-500
    approaching: '#facc15', // yellow-400
    touched: '#3b82f6',     // blue-400
    broken: '#ef4444',      // red-400
    bounced: '#a855f7',     // purple-400
    rejected: '#f97316',    // orange-400
  }
  return (colors[status] ?? '#6b7280')
}

export const PriceChart = memo(function PriceChart({
  priceHistory,
  levels,
  accentColor,
  height = 350,
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  // Initialize chart on mount
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#1a1e2e' },
        textColor: '#9ca3af',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      grid: {
        vertLines: { color: '#2c3352' },
        horzLines: { color: '#2c3352' },
      },
      rightPriceScale: {
        borderColor: '#3a4268',
        textColor: '#9ca3af',
      },
      timeScale: {
        borderColor: '#3a4268',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
      },
      width: chartContainerRef.current.clientWidth,
      height,
    })

    const lineSeries = chart.addLineSeries({
      color: accentColor,
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: accentColor,
      lastValueVisible: true,
    })

    chartRef.current = chart
    seriesRef.current = lineSeries

    // Set initial data
    if (priceHistory.length > 0) {
      // Cast to lightweight-charts compatible format
      lineSeries.setData(priceHistory as any)
      chart.timeScale().fitContent()
    }

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.resize(chartContainerRef.current.clientWidth, height, false)
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(chartContainerRef.current)

    // Cleanup
    return () => {
      resizeObserver.disconnect()
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [height, accentColor])

  // Update price data when history changes
  useEffect(() => {
    if (seriesRef.current && priceHistory.length > 0) {
      seriesRef.current.setData(priceHistory as any)
    }
  }, [priceHistory])

  // Update level lines when levels change
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return

    // Draw horizontal lines for each level
    levels.forEach((level) => {
      const color = getLevelColor(level.status)
      try {
        seriesRef.current?.createPriceLine({
          price: level.level,
          color: color,
          lineWidth: 1,
          lineStyle: 2, // Dashed line
          axisLabelVisible: true,
          title: level.level.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
        })
      } catch (error) {
        // Price line may already exist or be invalid, ignore
      }
    })
  }, [levels])

  return (
    <div
      ref={chartContainerRef}
      className="w-full bg-surface-800 rounded-lg border border-surface-600"
      style={{ height: `${height}px` }}
    />
  )
})

PriceChart.displayName = 'PriceChart'

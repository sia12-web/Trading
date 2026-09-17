'use client'

import { useState, useEffect, useRef } from 'react'

export interface InternetLatencyInfo {
  latencyMs: number
  jitterMs: number
  status: 'EXCELLENT' | 'HEALTHY' | 'FAIR' | 'POOR' | 'DISCONNECTED'
  isOnline: boolean
  lastMeasuredAt: number
}

/**
 * Client-side hook to dynamically monitor trader's local internet latency,
 * ping jitter, and connectivity status against the TradePulse trading gateway.
 */
export function useInternetLatency(intervalMs: number = 3000): InternetLatencyInfo {
  const [latencyInfo, setLatencyInfo] = useState<InternetLatencyInfo>({
    latencyMs: 0,
    jitterMs: 0,
    status: 'HEALTHY',
    isOnline: true,
    lastMeasuredAt: 0,
  })

  const prevLatencyRef = useRef<number>(0)
  const isMeasuringRef = useRef<boolean>(false)

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    let active = true

    const measurePing = async () => {
      if (isMeasuringRef.current || !active) return
      if (typeof window !== 'undefined' && !navigator.onLine) {
        setLatencyInfo({
          latencyMs: 0,
          jitterMs: 0,
          status: 'DISCONNECTED',
          isOnline: false,
          lastMeasuredAt: Date.now(),
        })
        return
      }

      isMeasuringRef.current = true
      const start = performance.now()

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 4000)

        const res = await fetch(`/api/trading/ping?_t=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (!active) return

        if (res.ok) {
          const rtt = Math.max(1, Math.round(performance.now() - start))
          const prev = prevLatencyRef.current || rtt
          const jitter = Math.abs(rtt - prev)
          prevLatencyRef.current = rtt

          let status: InternetLatencyInfo['status'] = 'HEALTHY'
          if (rtt <= 50) status = 'EXCELLENT'
          else if (rtt <= 100) status = 'HEALTHY'
          else if (rtt <= 200) status = 'FAIR'
          else status = 'POOR'

          setLatencyInfo({
            latencyMs: rtt,
            jitterMs: jitter,
            status,
            isOnline: true,
            lastMeasuredAt: Date.now(),
          })
        } else {
          setLatencyInfo((prev) => ({
            ...prev,
            status: 'POOR',
            lastMeasuredAt: Date.now(),
          }))
        }
      } catch {
        if (!active) return
        setLatencyInfo({
          latencyMs: 0,
          jitterMs: 0,
          status: 'DISCONNECTED',
          isOnline: false,
          lastMeasuredAt: Date.now(),
        })
      } finally {
        isMeasuringRef.current = false
      }
    }

    // Measure immediately on mount
    void measurePing()

    timer = setInterval(measurePing, intervalMs)

    const handleOnline = () => void measurePing()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void measurePing()
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      active = false
      if (timer) clearInterval(timer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [intervalMs])

  return latencyInfo
}

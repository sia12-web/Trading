import { getLevelStatusManager } from '@/lib/services/levelStatusManager'
import type { Instrument } from '@/types/price-feed'
import { LevelMonitorWidget } from './components/LevelMonitorWidget'
import { ErrorBoundary } from './components/ErrorBoundary'

export const metadata = {
  title: 'Level Monitor | TradePulse',
  description: 'Real-time support & resistance level monitoring for DOW, NASDAQ, NIKKEI',
}

const INSTRUMENTS: Instrument[] = ['DOW', 'NASDAQ', 'NIKKEI']

const PREDEFINED_LEVELS: Record<Instrument, number[]> = {
  DOW:    [33000, 34000, 35000, 36000, 37000, 38000],
  NASDAQ: [13000, 14000, 15000, 16000, 17000, 18000],
  NIKKEI: [26000, 27000, 28000, 29000, 30000, 31000],
}

export default function LevelMonitorPage() {
  const manager = getLevelStatusManager()

  const initialData = INSTRUMENTS.map((instrument) => {
    const levels = manager.getLevels(instrument)
    const currentPrice = manager.getCurrentPrice(instrument) ?? null

    const levelRows =
      levels.length > 0
        ? levels.map((l) => ({
            level: l.level,
            status: l.status,
            proximity: l.currentDistance.proximity,
            distance: parseFloat(l.currentDistance.distance.toFixed(2)),
            distancePct: parseFloat(l.currentDistance.distancePct.toFixed(4)),
            bounceCount: l.bounceCount,
            touchedAt: l.touchedAt?.toISOString() ?? null,
            brokenAt: l.brokenAt?.toISOString() ?? null,
            lastTouchPrice: l.lastTouchPrice,
          }))
        : PREDEFINED_LEVELS[instrument].map((lvl) => ({
            level: lvl,
            status: 'unvisited' as const,
            proximity: 'far' as const,
            distance: 0,
            distancePct: 0,
            bounceCount: 0,
            touchedAt: null,
            brokenAt: null,
            lastTouchPrice: null,
          }))

    return { instrument, currentPrice, levels: levelRows, timestamp: new Date().toISOString() }
  })

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Level Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time support &amp; resistance tracking · DOW · NASDAQ · NIKKEI
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-surface-700 border border-surface-500 px-3 py-1.5 rounded-lg">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Live data
        </div>
      </div>

      <ErrorBoundary>
        <LevelMonitorWidget initialData={initialData} />
      </ErrorBoundary>
    </div>
  )
}

import React from 'react'

interface LevelData {
  level: number
  status: string
  proximity: string
  distance: number
  distancePct: number
  bounceCount: number
  touchedAt: string | null
  brokenAt: string | null
  lastTouchPrice: number | null
}

interface Props {
  level: LevelData
  currentPrice: number
}

function statusBadgeColor(status: string): string {
  const colors: Record<string, string> = {
    unvisited: 'bg-gray-100 text-gray-700',
    approaching: 'bg-yellow-100 text-yellow-700',
    touched: 'bg-blue-100 text-blue-700',
    broken: 'bg-red-100 text-red-700',
    bounced: 'bg-purple-100 text-purple-700',
    rejected: 'bg-orange-100 text-orange-700',
  }
  return colors[status] ?? 'bg-gray-100 text-gray-700'
}

function proximityBarColor(proximity: string): string {
  const colors: Record<string, string> = {
    far: 'bg-gray-300',
    approaching: 'bg-yellow-400',
    at: 'bg-orange-500',
    breached: 'bg-red-600',
  }
  return colors[proximity] ?? 'bg-gray-300'
}

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    unvisited: '○',
    approaching: '▶',
    touched: '●',
    broken: '✕',
    bounced: '⟲',
    rejected: '⊘',
  }
  return icons[status] ?? '○'
}

export const LevelCard = React.memo(function LevelCard({ level, currentPrice }: Props) {
  const isAbove = currentPrice > level.level
  const proximityPercent = Math.min(100, Math.max(0, (level.distance / currentPrice) * 100))
  const barWidth = Math.min(100, proximityPercent * 5)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-blue-300 transition-all">
      {/* Header: Level value + Status badge */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-xs text-gray-500 font-semibold uppercase mb-1">Level</div>
          <div className="text-3xl font-bold text-gray-900">{level.level.toFixed(2)}</div>
        </div>

        {/* Status Badge with Icon */}
        <div className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${statusBadgeColor(level.status)}`}>
          <span>{statusIcon(level.status)}</span>
          <span>{level.status}</span>
        </div>
      </div>

      {/* Price Position Indicator */}
      <div className="mb-4 p-3 bg-gray-50 rounded flex justify-between text-sm">
        <span className="text-gray-600">
          Current: <span className="font-semibold text-gray-900">{currentPrice.toFixed(2)}</span>
        </span>
        <span className={`font-semibold ${isAbove ? 'text-green-600' : 'text-red-600'}`}>
          {isAbove ? '↑ Above' : '↓ Below'}
        </span>
      </div>

      {/* Proximity Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-600 mb-2">
          <span className="font-medium">Distance</span>
          <span className="font-semibold text-gray-900">
            {level.distancePct.toFixed(2)}% away
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
          <div
            className={`h-full transition-all duration-300 ${proximityBarColor(level.proximity)}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="text-xs text-gray-500 mt-1">Proximity: {level.proximity}</div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
        <div className="space-y-1">
          <div className="text-gray-500 text-xs">Price Distance</div>
          <div className="font-semibold text-gray-900">{level.distance.toFixed(2)}</div>
        </div>

        {level.bounceCount > 0 && (
          <div className="space-y-1">
            <div className="text-gray-500 text-xs">Bounces</div>
            <div className="font-semibold text-purple-600">{level.bounceCount}x</div>
          </div>
        )}

        {level.touchedAt && (
          <div className="space-y-1">
            <div className="text-gray-500 text-xs">Touched</div>
            <div className="font-semibold text-blue-600">
              {new Date(level.touchedAt).toLocaleTimeString()}
            </div>
          </div>
        )}

        {level.brokenAt && (
          <div className="space-y-1">
            <div className="text-gray-500 text-xs">Broken</div>
            <div className="font-semibold text-red-600">
              {new Date(level.brokenAt).toLocaleTimeString()}
            </div>
          </div>
        )}

        {level.lastTouchPrice && (
          <div className="space-y-1">
            <div className="text-gray-500 text-xs">Touch Price</div>
            <div className="font-semibold text-gray-900">{level.lastTouchPrice.toFixed(2)}</div>
          </div>
        )}
      </div>
    </div>
  )
})

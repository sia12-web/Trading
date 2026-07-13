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
  accentColor?: string
}

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  unvisited:   { bg: 'bg-gray-800/50',    text: 'text-gray-400',   border: 'border-gray-700/40',   dot: 'bg-gray-500' },
  approaching: { bg: 'bg-yellow-900/20',  text: 'text-yellow-400', border: 'border-yellow-700/40', dot: 'bg-yellow-400' },
  touched:     { bg: 'bg-blue-900/20',    text: 'text-blue-400',   border: 'border-blue-700/40',   dot: 'bg-blue-400' },
  broken:      { bg: 'bg-red-900/20',     text: 'text-red-400',    border: 'border-red-700/40',    dot: 'bg-red-400' },
  bounced:     { bg: 'bg-purple-900/20',  text: 'text-purple-400', border: 'border-purple-700/40', dot: 'bg-purple-400' },
  rejected:    { bg: 'bg-orange-900/20',  text: 'text-orange-400', border: 'border-orange-700/40', dot: 'bg-orange-400' },
}

const PROXIMITY_BAR: Record<string, string> = {
  far:        'bg-gray-700',
  approaching:'bg-yellow-500',
  at:         'bg-orange-500',
  breached:   'bg-red-500',
}

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    unvisited: '○', approaching: '▶', touched: '●',
    broken: '✕', bounced: '⟲', rejected: '⊘',
  }
  return icons[status] ?? '○'
}

export const LevelCard = React.memo(function LevelCard({ level, currentPrice, accentColor }: Props) {
  const hasLivePrice = currentPrice > 0
  const isAbove = hasLivePrice && currentPrice > level.level
  const proximityPercent = hasLivePrice && currentPrice !== 0
    ? Math.min(100, Math.max(0, (level.distance / currentPrice) * 100))
    : 0
  const barWidth = Math.min(100, proximityPercent * 5)

  const style = STATUS_STYLES[level.status] ?? STATUS_STYLES['unvisited']
  const barColor = PROXIMITY_BAR[level.proximity] ?? PROXIMITY_BAR['far']

  // Use type assertion since we know style is never undefined due to fallback
  const safeStyle = style!

  return (
    <div
      className={`relative rounded-xl border p-4 transition-all duration-200
        hover:scale-[1.02] hover:shadow-xl hover:shadow-black/40
        ${safeStyle.bg} ${safeStyle.border}`}
      role="article"
      aria-label={`Level ${level.level.toLocaleString()}, status: ${level.status}`}
    >
      {/* Accent glow on critical levels */}
      {level.proximity !== 'far' && (
        <div
          className="absolute inset-0 rounded-xl opacity-5 pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 0%, ${accentColor ?? '#3b7eff'}, transparent 70%)` }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-gray-600 font-medium uppercase tracking-wider mb-1">Level</div>
          <div className="text-2xl font-bold price-mono text-white">
            {level.level.toLocaleString('en-US')}
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${safeStyle.bg} ${safeStyle.text} ${safeStyle.border}`}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${safeStyle.dot} ${level.proximity !== 'far' ? 'animate-pulse' : ''}`}
            aria-label={`Level status: ${level.status}`}
            role="img"
          />
          <span>{statusIcon(level.status)}</span>
          <span className="capitalize">{level.status}</span>
        </div>
      </div>

      {/* Current price position */}
      <div className="mb-3 p-2.5 rounded-lg bg-surface-900/60 flex justify-between items-center text-sm">
        {hasLivePrice ? (
          <>
            <span className="text-gray-500 text-xs">
              Current <span className="price-mono text-gray-300">{currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </span>
            <span className={`text-xs font-bold ${isAbove ? 'text-green-400' : 'text-red-400'}`}>
              {isAbove ? '↑ Above' : '↓ Below'}
            </span>
          </>
        ) : (
          <span className="text-gray-600 text-xs italic">Awaiting live price…</span>
        )}
      </div>

      {/* Proximity bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-600 mb-1.5">
          <span>Distance</span>
          <span className="price-mono text-gray-400 font-semibold">{level.distancePct.toFixed(2)}%</span>
        </div>
        <div className="w-full h-1.5 bg-surface-900 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs border-t border-surface-600/50 pt-3">
        <div>
          <div className="text-gray-600">Δ Points</div>
          <div className="price-mono text-gray-300 font-semibold">{level.distance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>

        {level.bounceCount > 0 && (
          <div>
            <div className="text-gray-600">Bounces</div>
            <div className="price-mono text-purple-400 font-bold">{level.bounceCount}×</div>
          </div>
        )}

        {level.touchedAt && (
          <div>
            <div className="text-gray-600">Touched</div>
            <div className="price-mono text-blue-400">{new Date(level.touchedAt).toLocaleTimeString()}</div>
          </div>
        )}

        {level.brokenAt && (
          <div>
            <div className="text-gray-600">Broken</div>
            <div className="price-mono text-red-400">{new Date(level.brokenAt).toLocaleTimeString()}</div>
          </div>
        )}

        {level.lastTouchPrice && (
          <div>
            <div className="text-gray-600">Touch px</div>
            <div className="price-mono text-gray-300">{level.lastTouchPrice.toFixed(2)}</div>
          </div>
        )}
      </div>
    </div>
  )
})

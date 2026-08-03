'use client'

/**
 * Late / live desk brief panel — ranks DOW · NASDAQ · NIKKEI for late clock-in.
 */

import type { LiveDeskBrief } from '@/lib/trading/liveDeskBrief'

type Props = {
  brief: LiveDeskBrief | null
  loading?: boolean
  error?: string | null
}

export function LiveDeskBriefPanel({ brief, loading, error }: Props) {
  if (loading && !brief) {
    return (
      <p className="text-xs text-gray-400 animate-pulse">
        Computing live desk brief…
      </p>
    )
  }
  if (error && !brief) {
    return <p className="text-xs text-red-300/90">{error}</p>
  }
  if (!brief) return null

  return (
    <div className="text-left space-y-3 max-h-[50vh] overflow-y-auto pr-1">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        As of {brief.asOfDisplay} · recomputed on open
      </p>

      <ol className="space-y-2">
        {brief.instruments.map((card, i) => (
          <li
            key={card.instrument}
            className={`rounded-lg border px-3 py-2 ${
              card.tradeableNow
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-surface-600 bg-surface-800/60'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-white">
                {i + 1}. {card.instrument}
                {card.tradeableNow ? ' ★' : ''}
              </span>
              <span className="text-[10px] text-gray-400">{card.playbookTitle}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-300 leading-snug">
              {card.summaryLine}
            </p>
            <ul className="mt-1 space-y-0.5">
              {card.books.map((b) => (
                <li key={b.label} className="text-[10px] text-gray-400 leading-snug">
                  <span
                    className={
                      b.state === 'open'
                        ? 'text-emerald-400 font-bold'
                        : b.state === 'dead'
                          ? 'text-red-400/90 font-bold'
                          : b.state === 'forming'
                            ? 'text-amber-300 font-bold'
                            : 'text-gray-500 font-bold'
                    }
                  >
                    {b.state.toUpperCase()}
                  </span>{' '}
                  {b.label}: {b.note}
                </li>
              ))}
            </ul>
            {card.bandHint && (
              <p className="mt-1 text-[10px] text-amber-200/90">{card.bandHint}</p>
            )}
          </li>
        ))}
      </ol>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
          Since pre-market → now
        </p>
        <ul className="space-y-1">
          {brief.bullets.map((b) => (
            <li key={b} className="text-[11px] text-gray-300 leading-snug">
              • {b}
            </li>
          ))}
        </ul>
      </div>

      <p
        className={`text-xs font-semibold leading-snug ${
          brief.suggestion.kind === 'sit_out' ? 'text-gray-300' : 'text-amber-200'
        }`}
      >
        → {brief.suggestion.text}
      </p>
    </div>
  )
}

'use client'

/**
 * Three-state value-at-entry read. Honest labels, no countdown clock.
 */

import {
  valueAcceptanceLabel,
  type ValueAcceptanceResult,
  type ValueAcceptanceState,
} from '@/lib/trading/valueAcceptance'

const STATES: ValueAcceptanceState[] = [
  'still_auctioning',
  'looking_balanced',
  'looking_accepted',
]

const TONE: Record<
  ValueAcceptanceState,
  { chip: string; bar: string; text: string }
> = {
  still_auctioning: {
    chip: 'border-sky-700/60 bg-sky-950/40 text-sky-200',
    bar: 'bg-sky-500',
    text: 'text-sky-200',
  },
  looking_balanced: {
    chip: 'border-amber-700/60 bg-amber-950/40 text-amber-200',
    bar: 'bg-amber-400',
    text: 'text-amber-200',
  },
  looking_accepted: {
    chip: 'border-orange-600/70 bg-orange-950/50 text-orange-100',
    bar: 'bg-orange-400',
    text: 'text-orange-100',
  },
}

export function ValueAcceptanceRead({
  read,
  variant = 'compact',
}: {
  read: ValueAcceptanceResult
  variant?: 'compact' | 'bar'
}) {
  const tone = TONE[read.state]
  const label = valueAcceptanceLabel(read.state)

  if (variant === 'bar') {
    return (
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Value at entry
          </span>
          <span className={`text-[10px] font-bold uppercase tracking-wide ${tone.text}`}>
            {label}
          </span>
        </div>
        <div
          className="mt-2 grid grid-cols-3 gap-0.5"
          role="img"
          aria-label={label}
        >
          {STATES.map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full ${
                s === read.state ? TONE[s].bar : 'bg-[#21262d]'
              }`}
              title={valueAcceptanceLabel(s)}
            />
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-gray-300">{read.message}</p>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-0.5">
      <span
        className={`inline-flex rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${tone.chip}`}
        title={read.message}
      >
        {label}
      </span>
      <p className="text-[10px] leading-snug text-gray-400" title={read.message}>
        {read.message}
      </p>
    </div>
  )
}

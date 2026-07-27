'use client'

/**
 * After morning lunch (11:30 local): ask trader to confirm closing morning/IB books.
 * Auto-liquidation only happens later at cash close.
 */

interface Props {
  open: boolean
  instrument: string
  direction: string
  entryPrice: number
  cashCloseLabel: string
  busy?: boolean
  onConfirm: () => void
  onKeepOpen: () => void
}

export function MorningLunchFlatConfirm({
  open,
  instrument,
  direction,
  entryPrice,
  cashCloseLabel,
  busy = false,
  onConfirm,
  onKeepOpen,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#161b22] p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
          <h4 className="text-sm font-bold text-white">Morning desk ended — close now?</h4>
          <button
            type="button"
            onClick={onKeepOpen}
            disabled={busy}
            className="text-gray-400 hover:text-white transition text-sm"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-gray-300 leading-relaxed">
          Open {instrument} {direction.toUpperCase()} @ {entryPrice.toLocaleString()} is still live.
          Morning/IB books are <span className="text-amber-200 font-semibold">not</span> auto-flattened
          at lunch — confirm to close now, or keep it open until cash close (
          <span className="font-mono text-amber-100">{cashCloseLabel}</span>), when the system
          liquidates lunch-range and any leftover positions.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onKeepOpen}
            className="flex-1 rounded-lg border border-[#30363d] bg-transparent py-2.5 text-xs font-semibold text-gray-300 hover:bg-[#21262d] hover:text-white transition disabled:opacity-50"
          >
            Keep open until {cashCloseLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white py-2.5 text-xs font-bold uppercase tracking-wider transition shadow-md disabled:opacity-50"
          >
            {busy ? 'Closing…' : 'Confirm close now'}
          </button>
        </div>
      </div>
    </div>
  )
}

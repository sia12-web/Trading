'use client'

/**
 * After clock-in: choose CALL (ticket gate) or regular playbook ±10.
 * Cannot dismiss without answering.
 */

interface Props {
  open: boolean
  busy?: boolean
  error?: string | null
  onChoose: (useCall: boolean) => void
}

export function DeskCallModePrompt({ open, busy = false, error = null, onChoose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-zinc-500/40 bg-[#161b22] p-5 shadow-2xl space-y-4">
        <h4 className="text-sm font-bold text-white">Use CALL?</h4>
        <p className="text-xs text-gray-300 leading-relaxed">
          Yes — CALL must agree (Open + Control). Tickets only on CALL-legal ±10.
        </p>
        <p className="text-xs text-gray-300 leading-relaxed">
          No — regular trading on painted ±10 of the 30-minute range, IB, US Range (Nikkei),
          and lunch-range (DOW / NASDAQ). CALL stays advise-only.
        </p>
        {error && (
          <p className="text-xs text-red-300 font-semibold">{error}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(false)}
            className="flex-1 rounded-lg border border-[#30363d] bg-transparent py-2.5 text-xs font-semibold text-gray-200 hover:bg-[#21262d] hover:text-white transition disabled:opacity-50"
          >
            No — regular ±10
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(true)}
            className="flex-1 rounded-lg bg-zinc-200 hover:bg-white text-black py-2.5 text-xs font-bold uppercase tracking-wider transition disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Yes — CALL'}
          </button>
        </div>
      </div>
    </div>
  )
}

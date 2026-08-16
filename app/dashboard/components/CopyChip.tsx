'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'

export function valueToCopy(n: number | string | null | undefined): string | null {
  if (n == null || n === '') return null
  if (typeof n === 'number') {
    if (!Number.isFinite(n)) return null
    return String(n)
  }
  const s = String(n).trim()
  return s || null
}

type Tone = 'neutral' | 'sl' | 'tp' | 'size'

const TONE: Record<Tone, string> = {
  neutral: 'border-white/15 text-gray-100 hover:border-sky-400/50 hover:bg-sky-500/15',
  sl: 'border-red-500/30 text-red-100 hover:border-red-400/70 hover:bg-red-500/20',
  tp: 'border-emerald-500/30 text-emerald-100 hover:border-emerald-400/70 hover:bg-emerald-500/20',
  size: 'border-sky-500/30 text-sky-100 hover:border-sky-400/70 hover:bg-sky-500/20',
}

export function CopyChip({
  label,
  value,
  display,
  tone = 'neutral',
}: {
  label: string
  value: number | string | null | undefined
  display?: string
  tone?: Tone
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  const text = valueToCopy(value)

  const onCopy = useCallback(async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }, [text])

  if (text == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-white/5 px-1.5 py-0.5 text-[11px] text-gray-600">
        <span className="text-[9px] font-semibold uppercase tracking-wide">{label}</span>
        —
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={`Copy ${label} ${text}`}
      className={`inline-flex items-center gap-1 rounded-md border bg-black/25 px-1.5 py-0.5 font-mono text-[11px] transition ${TONE[tone]}`}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <span>{copied ? 'copied' : display ?? text}</span>
    </button>
  )
}

export function CopyChipRow({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>
}

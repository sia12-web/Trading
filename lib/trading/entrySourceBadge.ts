import type { DeskEntrySource } from '@/lib/trading/positionSizing'

export function entrySourceLabel(source?: string | null): string {
  if (source === 'manual') return 'Manual'
  if (source === 'structure') return 'Structure'
  if (source === 'ai') return 'AI level'
  return '—'
}

export function entrySourceTone(source?: string | null): string {
  if (source === 'manual') return 'bg-amber-500/20 text-amber-200 border-amber-600/40'
  if (source === 'structure') return 'bg-violet-500/20 text-violet-200 border-violet-600/40'
  if (source === 'ai') return 'bg-emerald-500/20 text-emerald-200 border-emerald-600/40'
  return 'bg-white/10 text-gray-400 border-white/10'
}

export function asEntrySource(raw?: string | null): DeskEntrySource | null {
  if (raw === 'ai' || raw === 'structure' || raw === 'manual') return raw
  return null
}

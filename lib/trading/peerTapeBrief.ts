/**
 * One-glance NY twin tape for Level Finder.
 * Pro use: CONFIRM / DIVERGE only — never copy peer prices as trade levels.
 * DOW ↔ NASDAQ. NIKKEI has no twin on this desk (skip).
 */

import { getYahooQuote } from '@/lib/yahoo/quote'
import type { DeskInstrument } from '@/lib/trading/sessionGate'

export type PeerLean = 'confirm_bull' | 'confirm_bear' | 'diverge' | 'neutral'

export type PeerTapeBrief = {
  primary: DeskInstrument
  peer: DeskInstrument
  primaryGapPct: number | null
  peerGapPct: number | null
  peerChangePct: number | null
  lean: PeerLean
  promptText: string
}

/** NY desk twin only — keep one peer so the model is not distracted. */
export function peerInstrumentFor(
  primary: DeskInstrument
): DeskInstrument | null {
  if (primary === 'DOW') return 'NASDAQ'
  if (primary === 'NASDAQ') return 'DOW'
  return null
}

function gapPctFromQuote(q: {
  price: number
  previous_close?: number
  change_pct?: number
} | null): number | null {
  if (!q || !(q.price > 0)) return null
  if (typeof q.change_pct === 'number' && Number.isFinite(q.change_pct)) {
    return q.change_pct
  }
  const prev = q.previous_close
  if (prev && prev > 0) return ((q.price - prev) / prev) * 100
  return null
}

/** Exported for tests — same lean rules the prompt uses. */
export function classifyPeerLean(
  primaryGap: number | null,
  peerGap: number | null
): PeerLean {
  if (primaryGap == null || peerGap == null) return 'neutral'
  const thr = 0.12 // ignore noise under ~12 bps
  const p = Math.abs(primaryGap) < thr ? 0 : Math.sign(primaryGap)
  const e = Math.abs(peerGap) < thr ? 0 : Math.sign(peerGap)
  if (p === 0 && e === 0) return 'neutral'
  if (p !== 0 && e !== 0 && p !== e) return 'diverge'
  if (p > 0 || e > 0) {
    if (p >= 0 && e >= 0) return 'confirm_bull'
  }
  if (p < 0 || e < 0) {
    if (p <= 0 && e <= 0) return 'confirm_bear'
  }
  return 'neutral'
}

function leanLabel(lean: PeerLean): string {
  switch (lean) {
    case 'confirm_bull':
      return 'CONFIRM bullish (both leaning up) — normal conviction OK'
    case 'confirm_bear':
      return 'CONFIRM bearish (both leaning down) — normal conviction OK'
    case 'diverge':
      return 'DIVERGE — prefer fewer levels, favor WATCH over PRIMARY, note peer diverge in reasoning'
    default:
      return 'NEUTRAL — peer not a strong signal; ignore for conviction'
  }
}

/**
 * Fetch primary + twin quotes and return a short prompt block.
 * Failures return null (Level Finder continues without peer).
 */
export async function buildPeerTapeBrief(
  primary: DeskInstrument
): Promise<PeerTapeBrief | null> {
  const peer = peerInstrumentFor(primary)
  if (!peer) return null

  try {
    const [primaryQ, peerQ] = await Promise.all([
      getYahooQuote(primary),
      getYahooQuote(peer),
    ])
    const primaryGapPct = gapPctFromQuote(primaryQ)
    const peerGapPct = gapPctFromQuote(peerQ)
    const peerChangePct =
      peerQ && typeof peerQ.change_pct === 'number' ? peerQ.change_pct : peerGapPct
    const lean = classifyPeerLean(primaryGapPct, peerGapPct)

    const fmt = (n: number | null) =>
      n == null || !Number.isFinite(n) ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

    const promptText = [
      `PEER TAPE (${peer} only — context, NOT levels):`,
      `- ${primary} day/gap: ${fmt(primaryGapPct)} · ${peer} day/gap: ${fmt(peerGapPct)} (change ${fmt(peerChangePct)})`,
      `- Lean: ${leanLabel(lean)}`,
      `- RULES: All trade levels MUST be ${primary} prices from ${primary} candles/AVWAP/VP only.`,
      `  Never paste ${peer} prices onto the ${primary} chart. No S&P / ES — one twin is enough.`,
      `  Use peer only as CONFIRM vs DIVERGE for conviction sizing, not as a level source.`,
    ].join('\n')

    return {
      primary,
      peer,
      primaryGapPct,
      peerGapPct,
      peerChangePct,
      lean,
      promptText,
    }
  } catch {
    return null
  }
}

export function formatPeerTapeForPrompt(brief: PeerTapeBrief | null | undefined): string {
  return brief?.promptText?.trim() || ''
}

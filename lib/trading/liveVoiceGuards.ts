/**
 * Live Voice input guards — pure helpers for turn/react validation + rate limits.
 */

import {
  classifyLevelReaction,
  type LevelTagVerdict,
} from '@/lib/trading/liveVoiceReactionCore'

/** Max hold-to-talk upload (~30s webm). */
export const LIVE_VOICE_MAX_AUDIO_BYTES = 2 * 1024 * 1024

/** Cap spoken transcript length (also enforced in turn runner). */
export const LIVE_VOICE_MAX_TRANSCRIPT_CHARS = 800

/** Per-user sliding window. */
export const LIVE_VOICE_TURN_LIMIT = 20
export const LIVE_VOICE_TURN_WINDOW_MS = 60_000
export const LIVE_VOICE_REACT_LIMIT = 30
export const LIVE_VOICE_REACT_WINDOW_MS = 60_000

const buckets = new Map<string, number[]>()

/** Test helper — clear in-memory rate buckets. */
export function resetLiveVoiceRateLimits(): void {
  buckets.clear()
}

/**
 * Sliding-window rate limit. Returns true when the call is allowed.
 */
export function checkLiveVoiceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): boolean {
  const cutoff = now - windowMs
  const prev = buckets.get(key) || []
  const recent = prev.filter((t) => t > cutoff)
  if (recent.length >= limit) {
    buckets.set(key, recent)
    return false
  }
  recent.push(now)
  buckets.set(key, recent)
  return true
}

export function validateLiveVoiceAudioSize(bytes: number | null | undefined): {
  ok: boolean
  reason: string | null
} {
  if (bytes == null || !(bytes > 0)) return { ok: true, reason: null }
  if (bytes > LIVE_VOICE_MAX_AUDIO_BYTES) {
    return {
      ok: false,
      reason: `Audio too large (max ${Math.round(LIVE_VOICE_MAX_AUDIO_BYTES / (1024 * 1024))}MB)`,
    }
  }
  return { ok: true, reason: null }
}

export function sanitizeLiveVoiceTranscript(raw: string | null | undefined): string {
  return String(raw || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, LIVE_VOICE_MAX_TRANSCRIPT_CHARS)
    .trim()
}

/**
 * Recompute verdict from tip vs level so clients cannot invent held/broke/tagged.
 * held/broke require tip already outside the tag band (wasTagged=true path).
 */
export function assertReactVerdictMatchesTip(args: {
  tip: number
  level: number
  side: 'BUY' | 'SHORT' | null
  verdict: LevelTagVerdict
}): { ok: true } | { ok: false; reason: string } {
  const { tip, level, side, verdict } = args
  if (!(tip > 0) || !(level > 0) || !Number.isFinite(tip) || !Number.isFinite(level)) {
    return { ok: false, reason: 'Invalid tip or level price' }
  }

  if (verdict === 'tagged') {
    const v = classifyLevelReaction({ tip, level, side, wasTagged: false })
    if (v !== 'tagged') {
      return { ok: false, reason: 'Tip is not tagging this level' }
    }
    return { ok: true }
  }

  const v = classifyLevelReaction({ tip, level, side, wasTagged: true })
  if (v !== verdict) {
    return { ok: false, reason: 'Verdict does not match tip vs level' }
  }
  return { ok: true }
}

export function parseTranscriptDays(raw: string | null): number {
  const n = parseInt(raw || '14', 10)
  if (!Number.isFinite(n)) return 14
  return Math.min(Math.max(n, 1), 90)
}

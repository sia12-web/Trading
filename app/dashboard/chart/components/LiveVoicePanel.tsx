'use client'

/**
 * Live Voice — status, context, hold-to-talk, level-tag reactions (Slices 1–5).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveVoiceStatus } from '@/lib/trading/liveVoice'
import { classifyLevelReaction } from '@/lib/trading/liveVoiceReactionCore'

type Instrument = 'DOW' | 'NASDAQ' | 'NIKKEI'

type StatusPayload = LiveVoiceStatus & {
  success?: boolean
  error?: string
}

type PinChip = {
  price: number
  side: 'BUY' | 'SHORT' | null
  reason: string | null
}

type WatchLevel = {
  price: number
  side: 'BUY' | 'SHORT' | null
  source: 'pin' | 'ai'
}

type ContextSummary = {
  enabled: boolean
  phase: string
  instrument: string
  levelCount: number
  levelsSource: 'ai' | 'empty'
  focusSide: string
  overnightReady: boolean
  regime: string | null
  attemptsUsed: number
  maxAttempts: number
  avwap: string
  pinCount?: number
  pins?: PinChip[]
  watchLevels?: WatchLevel[]
}

type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking'

type TurnLine = { role: 'user' | 'assistant'; text: string }

export function LiveVoicePanel({
  instrument,
  clockedIn,
  refreshKey = 0,
  livePrice = null,
}: {
  instrument: Instrument
  clockedIn?: boolean
  refreshKey?: number
  /** Live tip for Slice 5 level-tag reactions */
  livePrice?: number | null
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [summary, setSummary] = useState<ContextSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [ctxLoading, setCtxLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle')
  const [turns, setTurns] = useState<TurnLine[]>([])
  const [lastReply, setLastReply] = useState<string | null>(null)
  const [pins, setPins] = useState<PinChip[]>([])
  const [reactionLine, setReactionLine] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const speechTextRef = useRef('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const holdingRef = useRef(false)
  const taggedLevelsRef = useRef<Set<string>>(new Set())
  const reactedKeysRef = useRef<Set<string>>(new Set())
  const reactInFlightRef = useRef(false)
  const voicePhaseRef = useRef<VoicePhase>('idle')
  const watchLevelsRef = useRef<WatchLevel[]>([])
  const summaryPhaseRef = useRef<string>('')

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/trading/live-voice/status?instrument=${encodeURIComponent(instrument)}&_=${Date.now()}`,
        { cache: 'no-store' }
      )
      const json = (await res.json().catch(() => null)) as StatusPayload | null
      if (res.status === 401) {
        setError(json?.reason || 'Unauthorized')
        setStatus(json)
        setSummary(null)
        return json
      }
      if (!res.ok || !json) {
        setError(json?.error || `Status failed (${res.status})`)
        return null
      }
      setError(null)
      setStatus(json)
      return json
    } catch {
      setError('Live Voice unreachable')
      return null
    } finally {
      setLoading(false)
    }
  }, [instrument])

  const refreshContext = useCallback(async () => {
    if (!clockedIn) {
      setSummary(null)
      setPins([])
      watchLevelsRef.current = []
      return
    }
    setCtxLoading(true)
    try {
      const res = await fetch(
        `/api/trading/live-voice/context?instrument=${encodeURIComponent(instrument)}&_=${Date.now()}`,
        { cache: 'no-store' }
      )
      const json = await res.json().catch(() => null)
      if (res.status === 403 || !res.ok || !json?.success || !json.summary) {
        setSummary(null)
        setPins([])
        watchLevelsRef.current = []
        return
      }
      const s = json.summary as ContextSummary
      setSummary(s)
      summaryPhaseRef.current = s.phase || ''
      if (Array.isArray(s.pins)) setPins(s.pins)
      if (Array.isArray(s.watchLevels)) {
        watchLevelsRef.current = s.watchLevels
      }
    } catch {
      setSummary(null)
      setPins([])
      watchLevelsRef.current = []
    } finally {
      setCtxLoading(false)
    }
  }, [instrument, clockedIn])

  const refresh = useCallback(async () => {
    const st = await refreshStatus()
    if (st?.clockedIn) await refreshContext()
    else setSummary(null)
  }, [refreshStatus, refreshContext])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh, refreshKey, clockedIn])

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    voicePhaseRef.current = voicePhase
  }, [voicePhase])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      recognitionRef.current?.stop()
      audioRef.current?.pause()
    }
  }, [])

  const playReply = useCallback(
    async (
      text: string,
      audioBase64: string | null,
      mime: string | null,
      opts?: { soft?: boolean }
    ) => {
      const soft = !!opts?.soft
      const phase = voicePhaseRef.current
      const busy =
        phase === 'listening' || phase === 'thinking' || phase === 'speaking'
      // Soft reactions never interrupt mic / turn TTS — show text only
      if (soft && busy) {
        setReactionLine(text)
        setLastReply(text)
        return
      }
      setVoicePhase('speaking')
      setLastReply(text)
      if (soft) setReactionLine(text)
      try {
        if (audioBase64 && mime) {
          const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))
          const blob = new Blob([bytes], { type: mime })
          const url = URL.createObjectURL(blob)
          audioRef.current?.pause()
          const audio = new Audio(url)
          audioRef.current = audio
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => {
              URL.revokeObjectURL(url)
              resolve()
            }
            audio.onerror = () => {
              URL.revokeObjectURL(url)
              reject(new Error('audio play failed'))
            }
            void audio.play()
          })
        } else if (typeof window !== 'undefined' && window.speechSynthesis) {
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(text)
            u.rate = 1.05
            u.onend = () => resolve()
            u.onerror = () => resolve()
            window.speechSynthesis.cancel()
            window.speechSynthesis.speak(u)
          })
        }
      } catch {
        /* ignore play errors */
      } finally {
        setVoicePhase('idle')
      }
    },
    []
  )

  // Slice 5: tip tags pin/AI levels during ENTRY/MANAGE — rate-limited on server
  useEffect(() => {
    if (livePrice == null || !(livePrice > 0)) return
    if (!status?.enabled || !clockedIn) return
    const phase = summaryPhaseRef.current
    const phaseOk = phase === 'ENTRY' || phase === 'MANAGE' || !!status.devBypass
    if (!phaseOk) return
    if (reactInFlightRef.current) return
    if (voicePhaseRef.current === 'listening' || voicePhaseRef.current === 'thinking') return

    const levels = watchLevelsRef.current
    if (levels.length === 0) return

    for (const lvl of levels) {
      const key = `${lvl.source}:${Math.round(lvl.price * 100) / 100}`
      const wasTagged = taggedLevelsRef.current.has(key)
      const verdict = classifyLevelReaction({
        tip: livePrice,
        level: lvl.price,
        side: lvl.side,
        wasTagged,
      })
      if (!verdict) continue

      const reactKey = `${key}:${verdict}`
      if (reactedKeysRef.current.has(reactKey)) continue

      reactInFlightRef.current = true
      void (async () => {
        try {
          const res = await fetch('/api/trading/live-voice/react', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instrument,
              price: lvl.price,
              tipPrice: livePrice,
              side: lvl.side,
              source: lvl.source,
              verdict,
            }),
          })
          const json = await res.json().catch(() => null)
          // Network/5xx: leave key unset so we can retry.
          if (!res.ok || !json?.success) return
          if (!json.reacted || !json.replyText) {
            // Burn only permanent skips (budget / unknown level); transient gates can retry
            const skip = String(json.skippedReason || '')
            if (
              /max|budget|not in desk|invalid/i.test(skip) ||
              skip.toLowerCase().includes('already')
            ) {
              reactedKeysRef.current.add(reactKey)
            }
            return
          }
          if (verdict === 'tagged') taggedLevelsRef.current.add(key)
          reactedKeysRef.current.add(reactKey)
          setTurns((prev) =>
            [...prev, { role: 'assistant' as const, text: String(json.replyText) }].slice(-6)
          )
          await playReply(
            String(json.replyText),
            json.audioBase64 ?? null,
            json.audioMime ?? null,
            { soft: true }
          )
        } catch {
          /* ignore */
        } finally {
          reactInFlightRef.current = false
        }
      })()
      break // one reaction per tip tick
    }
  }, [livePrice, status?.enabled, status?.devBypass, clockedIn, instrument, playReply])

  const submitTurn = useCallback(
    async (audioBlob: Blob | null, speechFallback: string) => {
      setVoicePhase('thinking')
      setError(null)
      try {
        const form = new FormData()
        form.set('instrument', instrument)
        if (speechFallback.trim()) form.set('transcript', speechFallback.trim())
        if (audioBlob && audioBlob.size > 0) {
          form.set('audio', audioBlob, 'hold.webm')
        }

        const res = await fetch('/api/trading/live-voice/turn', {
          method: 'POST',
          body: form,
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.success) {
          setError(json?.error || `Turn failed (${res.status})`)
          setVoicePhase('idle')
          return
        }

        const userText = String(json.transcript || speechFallback || '').trim()
        const reply = String(json.replyText || '').trim()
        setTurns((prev) => {
          const next = [
            ...prev,
            ...(userText ? [{ role: 'user' as const, text: userText }] : []),
            ...(reply ? [{ role: 'assistant' as const, text: reply }] : []),
          ]
          return next.slice(-6)
        })
        if (Array.isArray(json.pins)) {
          setPins(
            json.pins.map((p: PinChip) => ({
              price: Number(p.price),
              side: p.side === 'BUY' || p.side === 'SHORT' ? p.side : null,
              reason: p.reason ?? null,
            }))
          )
        }
        void refreshContext()
        await playReply(reply, json.audioBase64 ?? null, json.audioMime ?? null)
      } catch {
        setError('Turn unreachable — retry')
        setVoicePhase('idle')
      }
    },
    [instrument, playReply, refreshContext]
  )

  const startHold = useCallback(async () => {
    if (!status?.enabled || !status.micAllowed || holdingRef.current) return
    if (voicePhase === 'thinking' || voicePhase === 'speaking') return
    holdingRef.current = true
    setError(null)
    setVoicePhase('listening')
    speechTextRef.current = ''
    chunksRef.current = []

    // Browser STT fallback when Whisper key may be missing
    const SR =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined
    if (SR) {
      try {
        const rec = new SR()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = 'en-US'
        rec.onresult = (ev: SpeechRecognitionEvent) => {
          let text = ''
          for (let i = 0; i < ev.results.length; i++) {
            text += ev.results[i]![0]!.transcript
          }
          speechTextRef.current = text
        }
        recognitionRef.current = rec
        rec.start()
      } catch {
        recognitionRef.current = null
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start(200)
    } catch {
      // Mic denied — still allow speech-recognition-only if we got text
      streamRef.current = null
      mediaRecorderRef.current = null
      if (!recognitionRef.current) {
        setError('Mic permission denied')
        setVoicePhase('idle')
        holdingRef.current = false
      }
    }
  }, [status?.enabled, status?.micAllowed, voicePhase])

  const endHold = useCallback(async () => {
    if (!holdingRef.current) return
    holdingRef.current = false

    recognitionRef.current?.stop()
    recognitionRef.current = null

    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null

    let audioBlob: Blob | null = null
    if (recorder && recorder.state !== 'inactive') {
      audioBlob = await new Promise<Blob | null>((resolve) => {
        recorder.onstop = () => {
          const blob =
            chunksRef.current.length > 0
              ? new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
              : null
          resolve(blob)
        }
        try {
          recorder.stop()
        } catch {
          resolve(null)
        }
      })
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    const speechFallback = speechTextRef.current.trim()
    if ((!audioBlob || audioBlob.size < 200) && !speechFallback) {
      setError('Hold longer and speak, then release')
      setVoicePhase('idle')
      return
    }

    await submitTurn(audioBlob, speechFallback)
  }, [submitTurn])

  const enabled = !!status?.enabled
  // Keep enabled while listening so pointerup/release still fires on the button
  const canTalk =
    enabled &&
    !!status?.micAllowed &&
    voicePhase !== 'thinking' &&
    voicePhase !== 'speaking'
  const windowLabel = status
    ? `${status.window.start}–${status.window.end} ${status.window.tzLabel}`
    : '—'

  const phaseLabel =
    voicePhase === 'listening'
      ? 'Listening'
      : voicePhase === 'thinking'
        ? 'Thinking'
        : voicePhase === 'speaking'
          ? 'Speaking'
          : enabled
            ? 'Ready'
            : 'Off'

  return (
    <div
      className={`pointer-events-auto w-[min(340px,calc(100vw-1.5rem))] rounded-xl border shadow-lg backdrop-blur-md ${
        enabled
          ? 'border-violet-500/40 bg-[#161b22]/95'
          : 'border-white/10 bg-[#0d1117]/92'
      }`}
      data-live-voice={enabled ? 'ready' : 'disabled'}
      data-voice-phase={voicePhase}
    >
      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                enabled ? 'text-violet-200' : 'text-gray-500'
              }`}
            >
              Live Voice
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                voicePhase === 'listening'
                  ? 'bg-red-500/25 text-red-200'
                  : voicePhase === 'thinking'
                    ? 'bg-amber-500/25 text-amber-100'
                    : voicePhase === 'speaking'
                      ? 'bg-sky-500/25 text-sky-100'
                      : enabled
                        ? 'bg-violet-500/25 text-violet-100'
                        : 'bg-white/5 text-gray-500'
              }`}
            >
              {loading ? '…' : phaseLabel}
            </span>
            {summary && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
                Context
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] text-gray-500">
            {instrument} · {windowLabel}
            {status?.localTime ? ` · now ${status.localTime.slice(0, 5)}` : ''}
          </p>
        </div>
        <button
          type="button"
          disabled={!canTalk}
          onPointerDown={(e) => {
            e.preventDefault()
            void startHold()
          }}
          onPointerUp={(e) => {
            e.preventDefault()
            void endHold()
          }}
          onPointerLeave={() => {
            if (holdingRef.current) void endHold()
          }}
          onContextMenu={(e) => e.preventDefault()}
          title={
            canTalk
              ? 'Hold to talk — release to send'
              : status?.reason || 'Live Voice unavailable'
          }
          className={`flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full border text-[9px] font-bold uppercase tracking-wide transition ${
            voicePhase === 'listening'
              ? 'border-red-400/70 bg-red-600 text-white scale-105'
              : canTalk
                ? 'border-violet-400/50 bg-violet-600/90 text-white hover:bg-violet-500'
                : 'border-white/15 bg-black/30 text-gray-500 opacity-60'
          }`}
          aria-label="Hold to talk"
        >
          Mic
        </button>
      </div>

      <div className="border-t border-white/10 px-3 py-2 space-y-1.5">
        {error && <p className="text-[11px] text-amber-200/90">{error}</p>}
        {!error && !loading && !enabled && (
          <p className="text-[11px] leading-snug text-gray-400">
            {status?.reason || 'Live Voice unavailable'}
          </p>
        )}
        {!error && enabled && (
          <p className="text-[10px] text-gray-500">
            Hold Mic to talk · release to send · never places orders
          </p>
        )}
        {summary && (
          <div className="space-y-0.5 text-[11px] leading-snug text-gray-300">
            <p>
              <span className="text-gray-500">Desk · </span>
              {summary.phase}
              {summary.regime ? ` · ${summary.regime}` : ''}
            </p>
            <p>
              <span className="text-gray-500">Levels · </span>
              {summary.levelCount > 0
                ? `${summary.levelCount} ${summary.levelsSource} · focus ${summary.focusSide}`
                : ctxLoading
                  ? 'loading…'
                  : 'none yet'}
            </p>
            <p>
              <span className="text-gray-500">Book · </span>
              attempts {summary.attemptsUsed}/{summary.maxAttempts}
            </p>
          </div>
        )}
        {pins.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {pins.map((p) => (
              <span
                key={`${p.price}-${p.side || 'x'}`}
                title={p.reason || 'Your spoken pin'}
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  p.side === 'SHORT'
                    ? 'border-red-700/50 bg-red-950/40 text-red-200'
                    : p.side === 'BUY'
                      ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-200'
                      : 'border-violet-700/40 bg-violet-950/40 text-violet-100'
                }`}
              >
                {p.side ? `${p.side} ` : ''}
                {p.price.toLocaleString()}
              </span>
            ))}
          </div>
        )}
        {reactionLine && (
          <p className="rounded border border-sky-700/40 bg-sky-950/40 px-2 py-1 text-[10px] leading-snug text-sky-100">
            <span className="font-semibold uppercase tracking-wide text-sky-400/90">Tag · </span>
            {reactionLine}
          </p>
        )}
        {turns.length > 0 && (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-black/20 px-2 py-1.5">
            {turns.map((t, i) => (
              <p
                key={`${t.role}-${i}`}
                className={`text-[10px] leading-snug ${
                  t.role === 'user' ? 'text-violet-200/90' : 'text-gray-300'
                }`}
              >
                <span className="font-semibold uppercase tracking-wide text-gray-500">
                  {t.role === 'user' ? 'You · ' : 'Coach · '}
                </span>
                {t.text}
              </p>
            ))}
          </div>
        )}
        {!turns.length && lastReply && (
          <p className="text-[11px] leading-snug text-gray-300">{lastReply}</p>
        )}
        {loading && !status && (
          <p className="animate-pulse text-[11px] text-gray-500">Checking window…</p>
        )}
      </div>
    </div>
  )
}

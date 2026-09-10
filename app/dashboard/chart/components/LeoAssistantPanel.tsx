'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  parseLeoDirectives,
  type LeoChatContext,
  type LeoDataPoint,
  type LeoMessage,
  type LeoExecutionDirective,
} from '@/lib/ai/leoAssistant'

export interface ArmedDeskRule {
  id: string
  type: 'STAGNATION_TIMEOUT' | 'TELEGRAM_ALERT'
  description: string
  maxMinutes?: number
  targetPrice?: number
  targetReference?: string
  session?: string
  requireHighVolume?: boolean
  requireConfidence?: boolean
  createdAt: number
  status: 'ARMED' | 'TRIGGERED' | 'SATISFIED' | 'CANCELLED'
}

interface LeoAssistantPanelProps {
  context: LeoChatContext
  isOpen?: boolean
  onToggleOpen?: () => void
  onSelectDataPoint?: (point: LeoDataPoint) => void
  externalAttachedPoints?: LeoDataPoint[]
  onClearExternalAttachedPoints?: () => void
  onClosePosition?: (reason: string) => Promise<boolean | void>
  /** Place / amend / cancel orders when Leo emits PLACE_* / SET_* / CANCEL_WORKING */
  onLeoOrder?: (directive: LeoExecutionDirective) => Promise<boolean | void> | boolean | void
  /** When true, Leo knows this is the $1500 paper desk for this market */
  paperMode?: boolean
}

// Persistent in-memory session cache per instrument so switching charts retains each market's conversation
const leoHistoryByInstrument: Record<string, LeoMessage[]> = {}

function getWelcomeMessage(instrument: string, paperMode: boolean): LeoMessage {
  return {
    id: `welcome-${instrument}`,
    role: 'assistant',
    content: paperMode
      ? `**Leo · ${instrument} paper desk ($1,500).** I only trade this market’s sim book.\n\nAsk me about levels, then tell me to **go long/short**, **limit**, **stop**, or **flatten** — I will place the order on this chart’s $1,500 paper account.\n\nClick chart arrows to attach levels, or use the mic.`
      : `**Leo · ${instrument} live desk.** I only manage this market’s book.\n\nAsk about the auction, then tell me to **place / move / cancel / flatten** when you want execution.\n\nClick chart arrows to attach levels, or use the mic.`,
    timestamp: Date.now(),
  }
}

export function LeoAssistantPanel({
  context,
  isOpen: controlledIsOpen,
  onToggleOpen,
  externalAttachedPoints,
  onClearExternalAttachedPoints,
  onClosePosition,
  onLeoOrder,
  paperMode = false,
}: LeoAssistantPanelProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isPanelOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen

  const togglePanel = () => {
    if (onToggleOpen) {
      onToggleOpen()
    } else {
      setInternalIsOpen((prev) => !prev)
    }
  }

  const [messages, setMessagesState] = useState<LeoMessage[]>(() => {
    return leoHistoryByInstrument[`${context.instrument}:${paperMode ? 'paper' : 'live'}`]?.length
      ? leoHistoryByInstrument[`${context.instrument}:${paperMode ? 'paper' : 'live'}`]!
      : [getWelcomeMessage(context.instrument, paperMode)]
  })

  // Synchronize when the user switches tabs to a different instrument
  useEffect(() => {
    const existing = leoHistoryByInstrument[`${context.instrument}:${paperMode ? 'paper' : 'live'}`]
    if (existing && existing.length > 0) {
      setMessagesState(existing)
    } else {
      const welcome = [getWelcomeMessage(context.instrument, paperMode)]
      leoHistoryByInstrument[`${context.instrument}:${paperMode ? 'paper' : 'live'}`] = welcome
      setMessagesState(welcome)
    }
    setAttachedPoints([])
  }, [context.instrument, paperMode])

  const setMessages = (updater: LeoMessage[] | ((prev: LeoMessage[]) => LeoMessage[])) => {
    setMessagesState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      leoHistoryByInstrument[`${context.instrument}:${paperMode ? 'paper' : 'live'}`] = next
      return next
    })
  }

  const [inputPrompt, setInputPrompt] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [attachedPoints, setAttachedPoints] = useState<LeoDataPoint[]>([])
  const [armedRules, setArmedRules] = useState<ArmedDeskRule[]>([])

  // Voice state (Web Speech Recognition)
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const recognitionRef = useRef<any>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Sync external attached data points (clicked directly on chart arrows / canvas)
  useEffect(() => {
    if (externalAttachedPoints && externalAttachedPoints.length > 0) {
      setAttachedPoints((prev) => {
        const ids = new Set(prev.map((p) => p.id))
        const combined = [...prev]
        for (const p of externalAttachedPoints) {
          if (!ids.has(p.id)) {
            combined.push(p)
            ids.add(p.id)
          }
        }
        return combined
      })
      if (!isPanelOpen) {
        setInternalIsOpen(true)
      }
      onClearExternalAttachedPoints?.()
    }
  }, [externalAttachedPoints, isPanelOpen, onClearExternalAttachedPoints])

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Initialize Web Speech API for voice recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        setSpeechSupported(true)
        const recog = new SpeechRecognition()
        recog.continuous = false
        recog.interimResults = true
        recog.lang = 'en-US'

        recog.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0].transcript)
            .join('')
          setInputPrompt(transcript)
        }

        recog.onerror = (event: any) => {
          console.warn('[Leo Voice] Recognition error:', event.error)
          setIsListening(false)
        }

        recog.onend = () => {
          setIsListening(false)
        }

        recognitionRef.current = recog
      }
    }
  }, [])

  // Toggle voice recognition
  const toggleListening = () => {
    if (!recognitionRef.current) return
    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    } else {
      setInputPrompt('')
      try {
        recognitionRef.current.start()
        setIsListening(true)
      } catch (err) {
        console.warn('[Leo Voice] Start error:', err)
      }
    }
  }

  // Toggle attached data point
  const handleRemoveDataPoint = (pointId: string) => {
    setAttachedPoints((prev) => prev.filter((p) => p.id !== pointId))
  }

  // Speak text aloud using Web Speech Synthesis
  const speakText = (text: string) => {
    if (!ttsEnabled || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    // Clean markdown, brackets, and execute tags for smooth speech
    const clean = text
      .replace(/<execute>[\s\S]*?<\/execute>/gi, '')
      .replace(/[*#`_>-]/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .slice(0, 280)
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate = 1.05
    utterance.pitch = 1.0
    window.speechSynthesis.speak(utterance)
  }

  // Execute immediate position close
  const executeClosePosition = async (reason: string) => {
    try {
      if (onClosePosition) {
        await onClosePosition(reason)
      } else if (context.activePosition) {
        await fetch('/api/trading/positions/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_id: context.activePosition.positionId,
            instrument: context.activePosition.instrument,
            exit_price: context.currentPrice ?? context.activePosition.entryPrice,
            exit_reason: 'manual',
            exit_notes: reason,
          }),
        })
      }
      // Send telegram update
      await fetch('/api/trading/leo/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'POSITION_CLOSE',
          instrument: context.instrument,
          price: context.currentPrice ?? 0,
          pnlPoints: context.activePosition?.unrealizedPnlPoints,
          message: reason,
        }),
      }).catch(() => null)
    } catch (err) {
      console.error('[Leo] Close failed:', err)
    }
  }

  // Dispatch a Telegram alert
  const dispatchTelegramAlert = async (rule: ArmedDeskRule) => {
    try {
      const curPrice = context.currentPrice ?? rule.targetPrice ?? 0
      const attached = attachedPoints.find((p) => p.label === rule.targetReference)
      const res = await fetch('/api/trading/leo/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'TELEGRAM_ALERT',
          instrument: context.instrument,
          session: rule.session ?? context.sessionDetails?.sessionName ?? 'Active Session',
          referencePoint: rule.targetReference,
          price: curPrice,
          volume: (attached?.volume as string) ?? 'High Volume Confirmation',
          retestRatio: attached?.retestRatio,
          confidence: 'High ★★★★☆',
          message: `Price tested ${rule.targetReference} with high volume & execution confidence.`,
        }),
      })
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `tg-${Date.now()}`,
            role: 'assistant',
            content: `📱 **[TELEGRAM DISPATCHED]:** Alert sent for **${rule.targetReference}** at **${curPrice.toFixed(2)}** in ${rule.session ?? 'Session'}.`,
            timestamp: Date.now(),
          },
        ])
        speakText(`Telegram alert dispatched for ${rule.targetReference}`)
      }
    } catch (e) {
      console.error('[Leo] Telegram notify failed:', e)
    }
  }

  // Apply parsed directives
  const applyDirectives = (directives: LeoExecutionDirective[]) => {
    for (const d of directives) {
      if (d.action === 'CLOSE_POSITION') {
        void Promise.resolve(onClosePosition?.(d.reason)).then((ok) => {
          if (ok === false) {
            setMessages((prev) => [
              ...prev,
              {
                id: `leo-close-fail-${Date.now()}`,
                role: 'assistant',
                content: `⚠️ Could not close ${context.instrument}${paperMode ? ' paper' : ''} — no open position or no last price.`,
                timestamp: Date.now(),
              },
            ])
            return
          }
          speakText(`Position close executed: ${d.reason}`)
        })
      } else if (
        d.action === 'PLACE_MARKET' ||
        d.action === 'PLACE_LIMIT' ||
        d.action === 'PLACE_STOP' ||
        d.action === 'SET_STOP' ||
        d.action === 'SET_TARGET' ||
        d.action === 'CANCEL_WORKING'
      ) {
        void Promise.resolve(onLeoOrder?.(d)).then((ok) => {
          if (ok === false) {
            setMessages((prev) => [
              ...prev,
              {
                id: `leo-order-fail-${Date.now()}`,
                role: 'assistant',
                content: `⚠️ Could not execute **${d.action}** on ${context.instrument}${paperMode ? ' paper' : ''}. Check stop/target and that the book is free.`,
                timestamp: Date.now(),
              },
            ])
            return
          }
          speakText(`${d.action.replace(/_/g, ' ').toLowerCase()} sent`)
        })
      } else if (d.action === 'ARM_STAGNATION_RULE') {
        const newRule: ArmedDeskRule = {
          id: `stag-${Date.now()}`,
          type: 'STAGNATION_TIMEOUT',
          description: d.description ?? `Close if not in profit after ${d.maxMinutes}m`,
          maxMinutes: d.maxMinutes,
          createdAt: Date.now(),
          status: 'ARMED',
        }
        setArmedRules((prev) => [...prev.filter((r) => r.type !== 'STAGNATION_TIMEOUT'), newRule])
      } else if (d.action === 'ARM_TELEGRAM_ALERT') {
        const newRule: ArmedDeskRule = {
          id: `tg-${Date.now()}`,
          type: 'TELEGRAM_ALERT',
          description: `Telegram alert when price tests ${d.targetReference} (${d.targetPrice.toLocaleString()})`,
          targetPrice: d.targetPrice,
          targetReference: d.targetReference,
          session: d.session,
          requireHighVolume: d.requireHighVolume,
          requireConfidence: d.requireConfidence,
          createdAt: Date.now(),
          status: 'ARMED',
        }
        setArmedRules((prev) => [...prev, newRule])
      } else if (d.action === 'ARM_LVN_BULL_ENG_RULE') {
        setMessages((prev) => [
          ...prev,
          {
            id: `lvn-arm-${Date.now()}`,
            role: 'assistant',
            content: `📌 **Rule armed (watch):** ${d.description ?? 'LVN + bullish engulfing entry'}. Tell me **"Leo go"** when the engulfing prints and I will PLACE_MARKET / PLACE_LIMIT with SL under the engulfing low.`,
            timestamp: Date.now(),
          },
        ])
      } else if (d.action === 'CANCEL_RULES') {
        setArmedRules([])
        speakText('All rules cancelled.')
      }
    }
  }

  // ─── Real-time 1-Second Desk Rule Evaluation Loop ────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const pos = context.activePosition
      const curPrice = context.currentPrice

      setArmedRules((prevRules) => {
        let changed = false
        const nextRules = prevRules.map((rule) => {
          if (rule.status !== 'ARMED') return rule

          // 1. Stagnation Timeout Rule
          if (rule.type === 'STAGNATION_TIMEOUT') {
            if (!pos) {
              // Position closed externally
              changed = true
              return { ...rule, status: 'SATISFIED' as const }
            }

            const entryTime = new Date(pos.entryTimestamp).getTime()
            const elapsedMinutes = (Date.now() - entryTime) / 60000
            const maxM = rule.maxMinutes ?? 5

            if (elapsedMinutes >= maxM) {
              if (pos.unrealizedPnlPoints <= 0) {
                // EXECUTED! Stagnation timeout triggered
                changed = true
                const reason = `Stagnation timeout reached after ${maxM} minutes without positive profit`
                executeClosePosition(reason)
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `exec-${Date.now()}`,
                    role: 'assistant',
                    content: `🛑 **[LEO EXECUTED - STAGNATION EXIT]**\n\nPosition on ${pos.instrument} was open for ${elapsedMinutes.toFixed(1)}m without moving into profit (P&L: ${pos.unrealizedPnlPoints.toFixed(1)} pts).\n\n**Action**: Executed immediate market close. Position flattened.`,
                    timestamp: Date.now(),
                  },
                ])
                speakText(`Stagnation timeout reached after ${maxM} minutes. Position closed.`)
                return { ...rule, status: 'TRIGGERED' as const }
              } else {
                // Moved into profit! Rule satisfied
                changed = true
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `sat-${Date.now()}`,
                    role: 'assistant',
                    content: `✅ **[LEO STAGNATION RULE SATISFIED]**\n\nTrade is positive (+${pos.unrealizedPnlPoints.toFixed(1)} pts) after ${maxM} minutes. Holding trade per playbook.`,
                    timestamp: Date.now(),
                  },
                ])
                speakText('Trade moved into profit. Stagnation rule cleared.')
                return { ...rule, status: 'SATISFIED' as const }
              }
            }
          }

          // 2. Telegram Alert Rule
          if (rule.type === 'TELEGRAM_ALERT' && curPrice != null && rule.targetPrice != null) {
            const dist = Math.abs(curPrice - rule.targetPrice)
            if (dist <= 5) {
              // Target price reached!
              changed = true
              dispatchTelegramAlert(rule)
              return { ...rule, status: 'TRIGGERED' as const }
            }
          }

          return rule
        })

        return changed ? nextRules : prevRules
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [context.activePosition, context.currentPrice, context.instrument])

  // Send message to Leo via streaming API
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend ?? inputPrompt
    if (!text.trim() || isStreaming) return

    const userMessage: LeoMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachedPoints: [...attachedPoints],
    }

    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInputPrompt('')
    setIsStreaming(true)

    // Append streaming assistant placeholder
    const assistantId = `leo-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      },
    ])

    try {
      const response = await fetch('/api/trading/leo/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content:
              m.attachedPoints && m.attachedPoints.length > 0
                ? `${m.content}\n\n[Attached Data Points: ${m.attachedPoints
                    .map(
                      (p) =>
                        `${p.label}=${p.value}${p.session ? ` (${p.session})` : ''}${
                          p.volume ? ` vol=${p.volume}` : ''
                        }${p.retestRatio ? ` retest=${p.retestRatio}x` : ''}`
                    )
                    .join(', ')}]`
                : m.content,
          })),
          chartContext: {
            ...context,
            selectedDataPoints: attachedPoints,
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response stream body')

      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const dataStr = trimmed.slice(6)
          if (dataStr === '[DONE]') continue

          try {
            const parsed = JSON.parse(dataStr)
            if (parsed.text) {
              accumulated += parsed.text
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: accumulated } : msg
                )
              )
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Parse and execute directives (<execute>)
      const directives = parseLeoDirectives(accumulated)
      if (directives.length > 0) {
        applyDirectives(directives)
      }

      // Voice readout if enabled
      speakText(accumulated)
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: `⚠️ **Leo Desk Error:** Unable to stream response (${err?.message ?? 'Network error'}).`,
              }
            : msg
        )
      )
    } finally {
      setIsStreaming(false)
      setAttachedPoints([]) // reset attached after sending
    }
  }

  const activePos = context.activePosition

  return (
    <>
      {/* ─── Compact Minimized Dock Button ──────────────────────────────────── */}
      {!isPanelOpen && (
        <button
          type="button"
          onClick={togglePanel}
          className="group absolute bottom-12 right-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md bg-neutral-950/85 border border-purple-500/40 text-neutral-200 shadow-xl transition-all duration-200 hover:border-purple-400 hover:bg-neutral-900/90 hover:scale-105 active:scale-95 select-none"
          title="Open Leo AI Desk Assistant (Click to enable chart reference points)"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500" />
          </span>
          <span className="font-mono text-xs font-semibold tracking-wide text-purple-200 flex items-center gap-1">
            <span>🎙️</span>
            <span>Leo AI</span>
          </span>
          {activePos && (
            <span
              className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                activePos.isInProfit
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700'
                  : 'bg-rose-950/80 text-rose-300 border border-rose-700'
              }`}
            >
              {activePos.direction} {activePos.unrealizedPnlPoints >= 0 ? '+' : ''}
              {activePos.unrealizedPnlPoints.toFixed(1)}pt
            </span>
          )}
          {context.shortTermMoney?.ypoc != null && (
            <span className="hidden sm:inline font-mono text-[10px] text-neutral-400 border-l border-neutral-700 pl-1.5">
              Y-POC {context.shortTermMoney.ypoc}
            </span>
          )}
          <span className="text-[9px] text-purple-300 font-bold bg-purple-950/60 border border-purple-800/60 rounded px-1.5 py-0.5">
            AI Live
          </span>
        </button>
      )}

      {/* ─── Expanded Glassmorphism Assistant Panel ───────────────────────── */}
      {isPanelOpen && (
        <div className="absolute top-2 bottom-2 right-2 z-40 w-full max-w-[395px] flex flex-col rounded-2xl backdrop-blur-xl bg-neutral-950/90 border border-purple-500/35 shadow-2xl overflow-hidden transition-all duration-300">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-neutral-800/80 bg-neutral-900/60">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-xs text-purple-200 tracking-wider">
                    LEO DESK ASSISTANT
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-700/60 text-purple-300 font-mono">
                    AI Live
                  </span>
                </div>
                <div className="text-[10px] text-neutral-400 font-mono">
                  {context.instrument} · {context.currentPrice ? context.currentPrice.toFixed(2) : '---'} ·{' '}
                  {context.currentTimeEt || '9:30 ET'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* TTS Voice Toggle */}
              <button
                type="button"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`p-1.5 rounded-lg border text-xs transition-colors ${
                  ttsEnabled
                    ? 'border-purple-500 bg-purple-950/70 text-purple-300'
                    : 'border-neutral-800 bg-neutral-900/50 text-neutral-500 hover:text-neutral-300'
                }`}
                title={ttsEnabled ? 'Voice readout enabled' : 'Voice readout muted'}
              >
                {ttsEnabled ? '🔊' : '🔇'}
              </button>

              {/* Minimize */}
              <button
                type="button"
                onClick={togglePanel}
                className="p-1.5 rounded-lg border border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 transition-colors text-xs"
                title="Minimize panel"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Time, Session & Market Telemetry Bar */}
          <div className="px-3 py-1.5 bg-neutral-900/50 border-b border-neutral-800/60 flex items-center justify-between text-[10px] font-mono text-neutral-300">
            <span className="flex items-center gap-1">
              <span className="text-neutral-500">Session:</span>
              <span className="text-amber-300 font-semibold">
                {context.sessionDetails?.sessionName ?? context.dayType ?? 'Active'}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-sky-300 font-semibold">
                {context.sessionDetails?.sessionElapsedMinutes != null
                  ? `${context.sessionDetails.sessionElapsedMinutes}m in`
                  : context.openingType ?? 'Open Auction'}
              </span>
            </span>
            {context.sessionDetails?.barCountdown && (
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {context.sessionDetails.barCountdown}
              </span>
            )}
          </div>

          {/* ── Active Position Management Card (When In Trade) ── */}
          {activePos && (
            <div className="px-3 py-2 border-b border-neutral-800/80 bg-neutral-900/80">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                      activePos.direction === 'LONG'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                        : 'bg-rose-950 text-rose-400 border border-rose-700'
                    }`}
                  >
                    {activePos.direction} {activePos.positionSize}x
                  </span>
                  <span className="text-xs font-mono font-bold text-white">
                    @{activePos.entryPrice.toFixed(2)}
                  </span>
                </div>
                <div
                  className={`text-xs font-mono font-extrabold ${
                    activePos.isInProfit ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {activePos.unrealizedPnlPoints >= 0 ? '+' : ''}
                  {activePos.unrealizedPnlPoints.toFixed(1)} pts
                  {activePos.unrealizedPnlCad != null && (
                    <span className="text-[10px] ml-1 opacity-80">
                      ({activePos.unrealizedPnlCad >= 0 ? '+' : ''}
                      {activePos.unrealizedPnlCad.toFixed(2)}$)
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 mt-1">
                <span>⏱️ {activePos.durationMinutes.toFixed(1)}m in trade</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleSendMessage(
                        'Leo if we are in this position and we have not moved to profit after 5 minutes, close the position.'
                      )
                    }
                    className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300 hover:bg-amber-900/90 text-[9px]"
                    title="Arm 5-minute stagnation exit rule"
                  >
                    ⏳ Arm 5m Timeout
                  </button>
                  <button
                    type="button"
                    onClick={() => executeClosePosition('Trader button click: Close position')}
                    className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[9px] shadow"
                  >
                    ⚡ Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Armed Desk Rules Tray (Stagnation & Telegram Rules) ── */}
          {armedRules.filter((r) => r.status === 'ARMED').length > 0 && (
            <div className="px-3 py-1.5 border-b border-purple-900/60 bg-purple-950/40 space-y-1">
              {armedRules
                .filter((r) => r.status === 'ARMED')
                .map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between text-[10px] font-mono text-purple-200"
                  >
                    <span className="flex items-center gap-1.5 truncate max-w-[290px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      <span className="truncate">{rule.description}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setArmedRules((prev) =>
                          prev.map((r) =>
                            r.id === rule.id ? { ...r, status: 'CANCELLED' as const } : r
                          )
                        )
                      }
                      className="text-[9px] text-neutral-400 hover:text-rose-400 font-bold ml-1 underline"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* ── User Drawn Tools Quick-Attach Strip ── */}
          {context.userDrawings &&
            (context.userDrawings.trendlines.length > 0 ||
              context.userDrawings.ranges.length > 0 ||
              context.userDrawings.frvps.length > 0) && (
              <div className="px-3 py-1.5 border-b border-neutral-800/60 bg-neutral-950/60 flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] text-cyan-400 font-mono font-semibold flex items-center gap-1">
                  <span>🎨</span> Drawn:
                </span>
                {context.userDrawings.trendlines.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (attachedPoints.some((p) => p.id === `user-tl-${t.id}`)) return
                      setAttachedPoints((prev) => [
                        ...prev,
                        {
                          id: `user-tl-${t.id}`,
                          label: t.label || 'Trendline',
                          value: `${t.startPrice.toLocaleString()} → ${t.endPrice.toLocaleString()}`,
                          tier: 'DRAWING',
                          category: 'TRENDLINE',
                          description: `${t.slopeDirection} trendline (${t.slopePtsPer5mBar} pts/5m). Price is ${t.priceRelation}.`,
                        },
                      ])
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-950/60 hover:bg-sky-900/80 border border-sky-600/50 text-[9.5px] font-mono text-sky-200 transition shadow-sm"
                    title="Click to attach this trendline to your message"
                  >
                    <span>📐</span> {t.label || 'Trendline'}
                  </button>
                ))}
                {context.userDrawings.ranges.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      if (attachedPoints.some((p) => p.id === `user-range-${r.id}`)) return
                      setAttachedPoints((prev) => [
                        ...prev,
                        {
                          id: `user-range-${r.id}`,
                          label: r.label || 'Range Box',
                          value: `${r.priceLow.toLocaleString()} – ${r.priceHigh.toLocaleString()}`,
                          tier: 'DRAWING',
                          category: 'RANGE',
                          description: `${r.heightPts} pts span (${r.durationMin}m). Price is ${r.priceRelation} range.`,
                        },
                      ])
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900/80 border border-purple-600/50 text-[9.5px] font-mono text-purple-200 transition shadow-sm"
                    title="Click to attach this range box to your message"
                  >
                    <span>⬛</span> {r.label || 'Range'} ({r.heightPts}p)
                  </button>
                ))}
                {context.userDrawings.frvps.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      if (attachedPoints.some((p) => p.id === `user-frvp-${f.id}`)) return
                      setAttachedPoints((prev) => [
                        ...prev,
                        {
                          id: `user-frvp-${f.id}`,
                          label: f.label || 'Manual FRVP',
                          value: `POC ${f.poc.toLocaleString()}`,
                          tier: 'DRAWING',
                          category: 'FRVP',
                          volume: f.totalVolume,
                          description: `Manual FRVP: POC ${f.poc} | VAH ${f.vah} | VAL ${f.val}. Price is ${f.priceRelation.replace('_', ' ')}.`,
                        },
                      ])
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900/80 border border-amber-600/50 text-[9.5px] font-mono text-amber-200 transition shadow-sm"
                    title="Click to attach this manual FRVP to your message"
                  >
                    <span>📊</span> FRVP (POC {f.poc.toLocaleString()})
                  </button>
                ))}
              </div>
            )}

          {/* ── Clean Clicked Chart Reference Pill (Direct from Canvas Arrows) ── */}
          {attachedPoints.length > 0 && (
            <div className="px-3 py-1.5 border-b border-neutral-800/70 bg-neutral-900/70 flex flex-wrap items-center gap-1">
              <span className="text-[9px] text-neutral-400 font-mono">Attached:</span>
              {attachedPoints.map((pt) => (
                <span
                  key={pt.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-950/90 border border-purple-500/70 text-[10px] font-mono text-purple-200 shadow-sm"
                >
                  <span className="font-bold">
                    {pt.category === 'TRENDLINE'
                      ? '📐'
                      : pt.category === 'RANGE'
                        ? '⬛'
                        : pt.category === 'FRVP'
                          ? '📊'
                          : '📍'}{' '}
                    {pt.label}:
                  </span>
                  <span className="text-amber-300 font-semibold">{pt.value}</span>
                  {pt.volume && <span className="text-neutral-400">({pt.volume})</span>}
                  {pt.retestRatio != null && (
                    <span className="text-sky-300 font-semibold">[{pt.retestRatio}x]</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveDataPoint(pt.id)}
                    className="hover:text-rose-400 font-bold ml-1 text-xs"
                    title="Remove attached point"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setAttachedPoints([])}
                className="text-[8px] text-neutral-500 hover:text-neutral-300 underline ml-1"
              >
                Clear
              </button>
            </div>
          )}

          {/* Conversation History */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 font-sans text-xs min-h-[160px]">
            {messages.map((msg) => {
              const isUser = msg.role === 'user'
              // Strip <execute> block from regular visual chat text
              const displayContent = (msg.content || '').replace(/<execute>[\s\S]*?<\/execute>/gi, '').trim()

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="font-mono text-[9px] text-neutral-400 uppercase">
                      {isUser ? 'Trader' : 'Leo AI'}
                    </span>
                    <span className="font-mono text-[8px] text-neutral-600">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <div
                    className={`max-w-[92%] px-3.5 py-2.5 rounded-xl border leading-relaxed ${
                      isUser
                        ? 'bg-purple-900/40 border-purple-500/50 text-purple-100 rounded-br-sm'
                        : 'bg-neutral-900/80 border-neutral-800 text-neutral-200 rounded-bl-sm shadow-md'
                    }`}
                  >
                    {/* Attached Data Point Chips on User Messages */}
                    {msg.attachedPoints && msg.attachedPoints.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2 pb-1.5 border-b border-purple-700/40">
                        {msg.attachedPoints.map((pt) => (
                          <span
                            key={pt.id}
                            className="px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-600/60 text-[9px] font-mono text-purple-300"
                          >
                            {pt.category === 'TRENDLINE'
                              ? '📐'
                              : pt.category === 'RANGE'
                                ? '⬛'
                                : pt.category === 'FRVP'
                                  ? '📊'
                                  : '📍'}{' '}
                            {pt.label}: {pt.value} {pt.volume ? `(${pt.volume})` : ''}{' '}
                            {pt.retestRatio != null ? `[${pt.retestRatio}x]` : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Message Body */}
                    <div className="whitespace-pre-wrap select-text selection:bg-purple-500/30">
                      {displayContent || (
                        <span className="inline-flex items-center gap-1 text-purple-400 animate-pulse font-mono text-[11px]">
                          Leo thinking...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Voice Feedback Preview if Listening */}
          {isListening && (
            <div className="px-3 py-1.5 bg-purple-950/70 border-t border-purple-700/50 flex items-center justify-between text-[11px] font-mono text-purple-200 animate-pulse">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                Listening... speak clearly to Leo
              </span>
              <button
                type="button"
                onClick={toggleListening}
                className="text-[10px] text-neutral-400 hover:text-neutral-200 underline"
              >
                Stop
              </button>
            </div>
          )}

          {/* Input & Voice Controls Bar */}
          <div className="p-2.5 border-t border-neutral-800/80 bg-neutral-900/70">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSendMessage()
              }}
              className="flex items-center gap-1.5"
            >
              {/* Mic Voice Button */}
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`relative p-2 rounded-xl border transition-all ${
                    isListening
                      ? 'border-red-500 bg-red-950/80 text-red-200 ring-2 ring-red-400 ring-offset-1 ring-offset-neutral-950'
                      : 'border-neutral-800 bg-neutral-800/60 text-neutral-400 hover:text-purple-300 hover:border-purple-600 hover:bg-neutral-800'
                  }`}
                  title={isListening ? 'Click to stop listening' : 'Click to speak to Leo (Voice Chat)'}
                >
                  {isListening ? (
                    <span className="flex items-center justify-center w-4 h-4 text-xs animate-bounce">
                      🎙️
                    </span>
                  ) : (
                    <span className="flex items-center justify-center w-4 h-4 text-xs">
                      🎤
                    </span>
                  )}
                </button>
              )}

              {/* Text Input */}
              <input
                type="text"
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                placeholder={
                  isListening
                    ? 'Listening to speech...'
                    : 'Speak to Leo or ask question...'
                }
                disabled={isStreaming}
                className="flex-1 px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-purple-500 transition-colors font-sans"
              />

              {/* Send Button */}
              <button
                type="submit"
                disabled={isStreaming || !inputPrompt.trim()}
                className="px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-mono text-xs font-semibold shadow-md transition-all active:scale-95 flex items-center justify-center"
              >
                {isStreaming ? (
                  <span className="animate-spin text-[10px]">⟳</span>
                ) : (
                  <span>Send</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

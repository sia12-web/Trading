'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  extractChartDataPoints,
  type LeoChatContext,
  type LeoDataPoint,
  type LeoMessage,
} from '@/lib/ai/leoAssistant'

interface LeoAssistantPanelProps {
  context: LeoChatContext
  isOpen?: boolean
  onToggleOpen?: () => void
  onSelectDataPoint?: (point: LeoDataPoint) => void
  externalAttachedPoints?: LeoDataPoint[]
  onClearExternalAttachedPoints?: () => void
}

export function LeoAssistantPanel({
  context,
  isOpen: controlledIsOpen,
  onToggleOpen,
  externalAttachedPoints,
  onClearExternalAttachedPoints,
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

  const [messages, setMessages] = useState<LeoMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `**Leo Online.** Institutional desk assistant calibrated to ${context.instrument}.\n\nMonitoring **Long-Term Money** (5M VWAP), **Intermediate Money** (5D POC), and **Short-Term Money** (Y-POC & ON-POC).\n\nClick any chart data point below or speak hands-free via mic.`,
      timestamp: Date.now(),
    },
  ])

  const [inputPrompt, setInputPrompt] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [attachedPoints, setAttachedPoints] = useState<LeoDataPoint[]>([])

  // Voice state (Web Speech Recognition)
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const recognitionRef = useRef<any>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Sync external attached data points (e.g. clicked on chart canvas)
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

  // Extract all currently active chart data points
  const activeDataPoints = extractChartDataPoints(context)

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
  const handleToggleDataPoint = (point: LeoDataPoint) => {
    setAttachedPoints((prev) => {
      const exists = prev.some((p) => p.id === point.id)
      if (exists) {
        return prev.filter((p) => p.id !== point.id)
      } else {
        return [...prev, point]
      }
    })
  }

  // Speak text aloud using Web Speech Synthesis
  const speakText = (text: string) => {
    if (!ttsEnabled || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    // Clean markdown asterisks and hashtags for smooth speech
    const clean = text
      .replace(/[*#`_>-]/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .slice(0, 300)
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate = 1.05
    utterance.pitch = 1.0
    window.speechSynthesis.speak(utterance)
  }

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
                ? `${m.content}\n\n[Attached Data Points: ${m.attachedPoints.map((p) => `${p.label}=${p.value}`).join(', ')}]`
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

      // Voice readout if enabled
      speakText(accumulated)
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: `⚠️ **Leo Desk Error:** Unable to stream response (${err?.message ?? 'Network error'}). Retrying with desk heuristic...`,
              }
            : msg
        )
      )
    } finally {
      setIsStreaming(false)
      setAttachedPoints([]) // reset attached after sending
    }
  }

  // Quick action templates
  const handleQuickPrompt = (template: string) => {
    handleSendMessage(template)
  }

  return (
    <>
      {/* ─── Compact Minimized Dock Button ──────────────────────────────────── */}
      {!isPanelOpen && (
        <button
          type="button"
          onClick={togglePanel}
          className="group absolute bottom-3 right-3 z-40 flex items-center gap-2.5 px-3.5 py-2 rounded-full backdrop-blur-md bg-neutral-950/80 border border-purple-500/40 text-neutral-200 shadow-xl transition-all duration-200 hover:border-purple-400 hover:bg-neutral-900/90 hover:scale-105 active:scale-95"
          title="Open Leo AI Desk Assistant"
        >
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500" />
          </span>
          <span className="font-mono text-xs font-semibold tracking-wide text-purple-200">
            🎙️ Leo AI
          </span>
          {context.shortTermMoney?.ypoc != null && (
            <span className="hidden sm:inline font-mono text-[10px] text-neutral-400 border-l border-neutral-700 pl-2">
              Y-POC {context.shortTermMoney.ypoc}
            </span>
          )}
          {context.intermediateMoney?.poc5d != null && (
            <span className="hidden md:inline font-mono text-[10px] text-sky-400">
              5D {context.intermediateMoney.poc5d}
            </span>
          )}
          <span className="text-[10px] text-purple-400 font-bold bg-purple-950/60 border border-purple-800/60 rounded px-1.5 py-0.5">
            Claude 3.7
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
                    Claude 3.7
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

          {/* Live Context Quick Bar */}
          <div className="px-3 py-1.5 bg-neutral-900/40 border-b border-neutral-800/60 flex items-center justify-between text-[10px] font-mono text-neutral-300">
            <span className="flex items-center gap-1">
              <span className="text-neutral-500">Day:</span>
              <span className="text-amber-300 font-semibold">{context.dayType ?? 'Forming'}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-neutral-500">Open:</span>
              <span className="text-sky-300 font-semibold">{context.openingType ?? 'Open Auction'}</span>
            </span>
            {context.shortTermMoney?.overnightBias && (
              <span className="text-purple-300 font-semibold truncate max-w-[110px]">
                {context.shortTermMoney.overnightBias.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {/* Interactive Clickable Data Points Tray */}
          <div className="px-3 py-2 border-b border-neutral-800/70 bg-neutral-950/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-mono font-medium">
                Clickable Chart Reference Points
              </span>
              <span className="text-[9px] text-purple-400 font-mono">
                {attachedPoints.length > 0 ? `${attachedPoints.length} attached` : 'Click to attach'}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {activeDataPoints.map((point) => {
                const isSelected = attachedPoints.some((p) => p.id === point.id)
                const tierColor =
                  point.tier === 'LT'
                    ? 'border-yellow-500/50 bg-yellow-950/40 text-yellow-300'
                    : point.tier === 'IT'
                      ? 'border-sky-500/50 bg-sky-950/40 text-sky-300'
                      : point.tier === 'ST'
                        ? 'border-amber-500/50 bg-amber-950/40 text-amber-300'
                        : 'border-purple-500/50 bg-purple-950/40 text-purple-300'

                const selectedColor = isSelected
                  ? 'ring-2 ring-purple-400 ring-offset-1 ring-offset-neutral-950 font-bold'
                  : 'opacity-85 hover:opacity-100 hover:scale-105'

                return (
                  <button
                    key={point.id}
                    type="button"
                    onClick={() => handleToggleDataPoint(point)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all flex items-center gap-1 ${tierColor} ${selectedColor}`}
                    title={point.description ?? `${point.label}: ${point.value}`}
                  >
                    <span>{point.label}</span>
                    <span className="font-semibold">{point.value}</span>
                    {isSelected && <span className="text-[8px] text-purple-300">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Quick Strategy Suggestion Chips */}
          <div className="px-3 py-1.5 border-b border-neutral-800/60 bg-neutral-900/30 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap text-[10px] font-mono">
            <span className="text-neutral-500 text-[9px]">Quick:</span>
            <button
              type="button"
              onClick={() =>
                handleQuickPrompt(
                  `Leo wait we get to below yesterday value (${context.shortTermMoney?.yval ?? 'Y-VAL'}) and once we see an excessive tail we see it as intermediate money, also we have the 5M VWAP line (${context.longTermMoney?.avwap5m ?? 'VWAP'}), so it might bring long term money and we can have a trend. Once we see that excess wait price tests it and once we get a candle stick in 5 minutes that shows bullish we get it and put stop loss below the tail.`
                )
              }
              className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-700/60 text-purple-200 hover:bg-purple-900/80 transition-colors"
            >
              🎯 Y-VAL Reversal Plan
            </button>
            <button
              type="button"
              onClick={() =>
                handleQuickPrompt(
                  `Leo what is the delta and confluence between 5D POC (${context.intermediateMoney?.poc5d ?? '5D'}) and Y-POC (${context.shortTermMoney?.ypoc ?? 'Y-POC'})? What does it imply for today's auction?`
                )
              }
              className="px-2 py-0.5 rounded bg-sky-950/60 border border-sky-700/60 text-sky-200 hover:bg-sky-900/80 transition-colors"
            >
              ⚖️ 5D vs Y-POC Delta
            </button>
            <button
              type="button"
              onClick={() =>
                handleQuickPrompt(
                  `Leo examine the overnight inventory bias (${context.shortTermMoney?.overnightBias ?? 'Inventory'}). If we open out of range, is an inventory rebalance likely?`
                )
              }
              className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-200 hover:bg-amber-900/80 transition-colors"
            >
              🔄 Inventory Rebalance
            </button>
          </div>

          {/* Conversation History */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 font-sans text-xs min-h-[160px]">
            {messages.map((msg) => {
              const isUser = msg.role === 'user'
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
                            📍 {pt.label}: {pt.value}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Message Body */}
                    <div className="whitespace-pre-wrap select-text selection:bg-purple-500/30">
                      {msg.content || (
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
            {attachedPoints.length > 0 && (
              <div className="flex items-center gap-1 mb-2 flex-wrap">
                <span className="text-[9px] text-neutral-400 font-mono">Attached:</span>
                {attachedPoints.map((pt) => (
                  <span
                    key={pt.id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-600/70 text-[9px] font-mono text-purple-300"
                  >
                    {pt.label}: {pt.value}
                    <button
                      type="button"
                      onClick={() => handleToggleDataPoint(pt)}
                      className="hover:text-red-400 font-bold ml-0.5"
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
                  Clear all
                </button>
              </div>
            )}

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
                    : 'Ask Leo or state strategy condition...'
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

'use client'

/**
 * Dow Jones Fundamental Analyst Conversational Terminal
 * Grounded in real-time CME YM telemetry, price weighting, cyclical rotation, and Wyckoff/CVD context
 */

import React, { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function DowAnalystChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-msg',
      role: 'assistant',
      content:
        'I am the **Dow Jones Macro, Cyclical Economy, Earnings and Rotation Analyst**. My market is CME E-mini Dow futures (`YM`, $5 multiplier). I continuously monitor price-weighted constituent contributions (Divisor ~0.1517), Treasury yields (differentiating growth-driven vs inflation-driven moves), ISM manufacturing & new orders, corporate credit spreads (HY OAS), and sector rotation. How can I assist your execution desk today?',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (textToSend?: string) => {
    const prompt = (textToSend || input).trim()
    if (!prompt || loading) return

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    const assistantMsgId = `assistant-${Date.now()}`
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
    }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      const res = await fetch('/api/fundamentals/dow/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('No readable stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim()
            if (dataStr === '[DONE]') continue
            try {
              const parsed = JSON.parse(dataStr)
              const chunkText = parsed.text || parsed.content
              if (chunkText) {
                accumulated += chunkText
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: accumulated } : m
                  )
                )
              }
            } catch {
              // Ignore partial parse
            }
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content:
                  '⚠️ [Desk Warning] Stream connection interrupted. Please check your connectivity and try again.',
              }
            : m
        )
      )
    } finally {
      setLoading(false)
    }
  }

  const promptSuggestions = [
    'How do UNH ($585) and GS ($535) moves dominate the price-weighted Dow vs lower-priced stocks?',
    'Explain why 10Y yield rises are classified as GROWTH_DRIVEN vs INFLATION_DRIVEN for Dow cyclicals.',
    'What does today\'s ISM New Orders print signal for industrial constituents like CAT and BA?',
    'How do corporate credit spreads (HY OAS) signal whether Dow consolidation is healthy or fragile?',
    'How does Wyckoff delta absorption at a 5-day volume profile LVN invalidate a bearish macro headline on YM?',
  ]

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl mb-8 flex flex-col h-[650px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">💬</span>
          <h2 className="text-base font-bold text-slate-100">
            Dow Fundamental Analyst Terminal
          </h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
            CME YM Telemetry Grounded
          </span>
        </div>
        <div className="text-xs text-slate-400">
          Strict institutional rules: price weighting ($\Delta P/d$), abnormal rejection detection
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${
              m.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400">
              <span className="font-semibold">
                {m.role === 'user' ? 'Execution Desk' : 'Dow Analyst'}
              </span>
            </div>
            <div
              className={`max-w-[85%] rounded-xl p-3.5 text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-950/80 border border-slate-800 text-slate-200 font-mono whitespace-pre-wrap'
              }`}
            >
              {m.content || (
                <span className="animate-pulse text-slate-500">
                  Synthesizing Dow macro, cyclical, and price-weighting assessment...
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Prompt Suggestions */}
      {messages.length <= 2 && (
        <div className="pb-3 border-t border-slate-800/80 pt-2">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
            Suggested Desk Inquiries:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {promptSuggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(s)}
                className="text-[10.5px] bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white px-2.5 py-1 rounded-md border border-slate-800 transition text-left"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
        className="flex items-center gap-2 pt-2 border-t border-slate-800"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about price weighting, ISM industrial demand, rotation into cyclicals, or credit spreads..."
          disabled={loading}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-50 flex items-center gap-1.5"
        >
          <span>{loading ? '...' : 'Send'}</span>
          <span>↵</span>
        </button>
      </form>
    </div>
  )
}

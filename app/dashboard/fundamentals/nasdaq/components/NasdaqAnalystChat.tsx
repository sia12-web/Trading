'use client'

/**
 * Nasdaq Fundamental Analyst Conversational Terminal
 * Grounded in real-time CME NQ telemetry, Treasury yields, breadth, guidance, and Wyckoff/CVD context
 */

import React, { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function NasdaqAnalystChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-msg',
      role: 'assistant',
      content:
        'I am the **Nasdaq-100 Macro, Earnings and Market-Flow Analyst**. My market is CME E-mini Nasdaq-100 (`NQ`). I continuously monitor Treasury yields (2Y, 10Y, 10Y real TIPS), FOMC expectations, SEC EDGAR mega-cap guidance, AI/semiconductor capex cycles, and market breadth to provide institutional context. How can I assist your execution desk today?',
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
      const res = await fetch('/api/fundamentals/nasdaq/chat', {
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
              if (parsed.content) {
                accumulated += parsed.content
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
    'How do current real yields affect NQ tech multiples?',
    'Explain the difference between an EPS beat and slashed forward guidance.',
    'Nasdaq breadth is unavailable. Which print would you need before calling participation broad or narrow?',
    'Why is hyperscaler capex bullish for semiconductors but margin-dilutive for spenders?',
    'How does Wyckoff delta absorption invalidate a hot CPI headline at the 5-day volume profile POC?',
  ]

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl mb-8 flex flex-col h-[650px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">💬</span>
          <h2 className="text-base font-bold text-slate-100">
            Nasdaq Fundamental Analyst Terminal
          </h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            CME NQ Telemetry Grounded
          </span>
        </div>
        <div className="text-xs text-slate-400">
          Strict institutional rules: guidance &gt; beats, abnormal rejection detection
        </div>
      </div>

      {/* Suggested Prompts */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-2 text-[11px] text-slate-300 no-scrollbar">
        <span className="text-slate-400 font-medium whitespace-nowrap">Suggested:</span>
        {promptSuggestions.map((s, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(s)}
            disabled={loading}
            className="px-2.5 py-1 rounded bg-slate-950/80 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-cyan-300 transition whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-3.5 pr-2 my-2 text-xs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${
              m.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div className="text-[10px] text-slate-400 mb-1 px-1">
              {m.role === 'user' ? 'Execution Desk' : 'Nasdaq Analyst (AI)'}
            </div>
            <div
              className={`max-w-[88%] p-3.5 rounded-xl leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'bg-slate-950/90 border border-slate-800 text-slate-200'
              }`}
            >
              {m.content || (loading && m.role === 'assistant' ? 'Analyzing transmission channels...' : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <div className="pt-3 border-t border-slate-800 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask about rate cut expectations, 10Y real yields, mega-cap capex, breadth divergences..."
          disabled={loading}
          className="flex-1 bg-slate-950/90 border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"
        />
        <button
          onClick={() => handleSend()}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-cyan-950/50"
        >
          {loading ? (
            <span className="animate-spin">🔄</span>
          ) : (
            <span>Send</span>
          )}
        </button>
      </div>
    </div>
  )
}

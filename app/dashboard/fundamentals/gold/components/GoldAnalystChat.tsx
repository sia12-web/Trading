'use client'

/**
 * Gold Fundamental Analyst Conversational Terminal
 * Grounded in real-time COMEX GC telemetry, FRED real yields, USD, and Wyckoff/CVD context
 */

import React, { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function GoldAnalystChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-msg',
      role: 'assistant',
      content:
        'I am the **Gold Macro, Monetary and Physical Demand Analyst**. My market is COMEX Gold (GC). I monitor real Treasury yields, FOMC expectations, the US dollar, central-bank reserve accumulation, WGC ETF flows, and CFTC positioning to provide macro context. How can I assist your desk today?',
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
      const res = await fetch('/api/fundamentals/gold/chat', {
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
              if (parsed.text) {
                accumulated += parsed.text
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: accumulated } : m
                  )
                )
              }
            } catch {
              // Non-JSON SSE string
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
                  '⚠️ Communication error connecting to Gold Analyst stream. Please verify network connectivity.',
              }
            : m
        )
      )
    } finally {
      setLoading(false)
    }
  }

  const quickPrompts = [
    'Evaluate 10Y real yield transmission to GC',
    'Assess CFTC Managed Money crowding risk',
    'Analyze PBOC & central bank reserve pace',
    'What market response would confirm a bearish rejection?',
  ]

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-xl mb-8 flex flex-col h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">💬</span>
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Gold Macro & Monetary Analyst Terminal
            </h2>
            <p className="text-[11px] text-slate-400">
              Conversational query terminal grounded in live FRED yields, DXY, and order flow context.
            </p>
          </div>
        </div>
      </div>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto my-3 space-y-3.5 pr-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${
              m.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div className="text-[10px] text-slate-500 mb-0.5 px-1 font-mono uppercase">
              {m.role === 'user' ? 'Desk Trader' : 'Gold Analyst'}
            </div>
            <div
              className={`max-w-[88%] rounded-xl p-3.5 text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-amber-600 text-slate-950 font-medium rounded-tr-none'
                  : 'bg-slate-950 border border-slate-800 text-slate-200 rounded-tl-none whitespace-pre-wrap'
              }`}
            >
              {m.content || (
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="animate-spin text-amber-400">🔄</span> Synthesizing telemetry...
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
        {quickPrompts.map((qp, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(qp)}
            disabled={loading}
            className="text-[11px] px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 hover:border-amber-500/40 transition disabled:opacity-50"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Input Field */}
      <div className="flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask about real yields, USD transmission, ETF flows, Wyckoff absorption..."
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
        />
        <button
          onClick={() => handleSend()}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition disabled:opacity-50 flex items-center gap-1"
        >
          <span>Send</span>
          <span>↵</span>
        </button>
      </div>
    </div>
  )
}

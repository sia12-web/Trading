'use client'

import React, { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function NikkeiAnalystChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-1',
      role: 'assistant',
      content:
        'Konnichiwa! I am **NIKKEI_AGENT**, your institutional Macro, Bank of Japan (BoJ), Currency Pass-Through & Technology Market Analyst for CME Nikkei 225 Futures (Globex: NKD, $5 multiplier) and the Tokyo Stock Exchange cash market.\n\nAsk me about BoJ rate hike scenarios, USD/JPY currency intervention thresholds, Tokyo Electron & Advantest price-weight leverage, or Tokyo cash session opening execution rules.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!input.trim() || loading) return

    const userMsgId = `user-${Date.now()}`
    const assistantMsgId = `assistant-${Date.now()}`

    const userMsg: Message = { id: userMsgId, role: 'user', content: input.trim() }
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '' }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/fundamentals/nikkei/chat', {
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
                  '⚠️ Failed to contact Nikkei Analyst Engine. Please check server connectivity or LLM API keys.',
              }
            : m
        )
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl flex flex-col h-[650px]">
      <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏯</span>
          <div>
            <h2 className="text-sm font-bold text-white">
              NIKKEI_AGENT Terminal
            </h2>
            <p className="text-[11px] text-slate-400">
              Interactive Japanese Macro, BoJ Policy & Semiconductor Analyst
            </p>
          </div>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          Chat ready
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
        {messages.map((m) => {
          const isUser = m.role === 'user'
          return (
            <div
              key={m.id}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 font-bold ${
                  isUser
                    ? 'bg-cyan-600 text-white'
                    : 'bg-red-600/30 text-red-200 border border-red-500/40'
                }`}
              >
                {isUser ? 'ME' : 'NKD'}
              </div>
              <div
                className={`max-w-[85%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed ${
                  isUser
                    ? 'bg-cyan-600 text-white rounded-tr-none'
                    : 'bg-slate-950/70 text-slate-200 border border-slate-800 rounded-tl-none whitespace-pre-wrap font-sans'
                }`}
              >
                {m.content}
              </div>
            </div>
          )
        })}
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-xs font-mono">
            <span className="animate-spin">🔄</span>
            <span>NIKKEI_AGENT is analyzing Tokyo market flow...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <form onSubmit={handleSend} className="pt-3 border-t border-slate-800 flex gap-2">
        <input
          type="text"
          placeholder="Ask NIKKEI_AGENT about BoJ hike impact, USD/JPY carry unwind, or Tokyo Electron..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          className="flex-1 px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold uppercase transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  )
}

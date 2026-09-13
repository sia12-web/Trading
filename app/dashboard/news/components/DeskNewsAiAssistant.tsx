'use client'

/**
 * Desk News AI Assistant Component.
 * Provides breaking news synthesis, 4 CME futures market reactions (DOW, NASDAQ, GOLD, CRUDE),
 * upcoming economic calendar events, and core market drivers.
 */

import { useState, useRef, useEffect } from 'react'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

const PRESET_PROMPTS = [
  {
    id: 'briefing',
    label: '⚡ Full Executive Briefing',
    prompt: 'Give me a complete Executive News & Market Reaction Briefing for our 4 futures markets.',
  },
  {
    id: 'reactions',
    label: '📊 Market Reactions (DOW, NQ, Gold, Crude)',
    prompt: 'Break down how the market reacted across DOW, NASDAQ, GOLD, and CRUDE to published news.',
  },
  {
    id: 'upcoming',
    label: '📅 Upcoming Tier-1 Catalysts',
    prompt: 'List upcoming high-impact economic calendar events and expected volatility levels for futures.',
  },
  {
    id: 'drivers',
    label: '💡 Core Fundamental Drivers',
    prompt: 'What are the main macro drivers currently moving DOW, NASDAQ, GOLD, and CRUDE Oil?',
  },
]

export function DeskNewsAiAssistant({ tab = 'ALL' }: { tab?: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(true)
  const responseEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    responseEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (streamingText || messages.length > 0) {
      scrollToBottom()
    }
  }, [streamingText, messages])

  const sendQuery = async (queryPrompt?: string) => {
    const textToSend = (queryPrompt || input).trim()
    if (!textToSend || loading) return

    const newMessages: Message[] = [...messages, { role: 'user', content: textToSend }]
    setMessages(newMessages)
    if (!queryPrompt) setInput('')
    setLoading(true)
    setStreamingText('')

    try {
      const res = await fetch('/api/trading/news-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, tab }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim()
            if (dataStr === '[DONE]') continue
            try {
              const json = JSON.parse(dataStr) as { text?: string }
              if (json.text) {
                accumulated += json.text
                setStreamingText(accumulated)
              }
            } catch {
              /* ignore parse errors on partial chunks */
            }
          }
        }
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: accumulated }])
      setStreamingText('')
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '⚠️ Failed to connect to Desk News AI. Please check your network or try again.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-violet-500/30 bg-gradient-to-b from-violet-950/30 to-slate-900/60 p-4 shadow-xl backdrop-blur-sm transition-all">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-500/20 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/30 text-base border border-violet-400/40">
            🤖
          </div>
          <div>
            <h2 className="text-sm font-bold text-violet-100 flex items-center gap-2">
              Desk News & Market Reaction AI
              <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300 border border-violet-500/40 uppercase">
                4 CME Futures
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Published news briefing, 4 CME market reactions (DOW, NQ, Gold, Crude), upcoming catalysts & macro drivers
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="rounded-lg border border-violet-500/30 bg-violet-900/20 px-2.5 py-1 text-xs font-semibold text-violet-300 hover:bg-violet-800/30 transition"
        >
          {isOpen ? 'Collapse AI' : 'Expand AI Assistant'}
        </button>
      </div>

      {isOpen && (
        <div className="mt-3.5 space-y-3.5">
          {/* Quick Action Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESET_PROMPTS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={loading}
                onClick={() => sendQuery(p.prompt)}
                className="rounded-lg border border-violet-500/30 bg-violet-900/20 px-2.5 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-600/30 hover:border-violet-400/50 hover:text-white transition disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Chat / Analysis Output Area */}
          {(messages.length > 0 || streamingText || loading) && (
            <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-3 text-xs leading-relaxed text-slate-200">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 ${
                    m.role === 'user'
                      ? 'bg-violet-900/30 border border-violet-500/30 text-violet-100 ml-6'
                      : 'bg-slate-900/90 border border-slate-800 text-slate-200 mr-2 space-y-2'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    {m.role === 'user' ? 'Trader Question' : 'Leo News AI Analysis'}
                  </div>
                  <div className="whitespace-pre-wrap font-sans">{m.content}</div>
                </div>
              ))}

              {streamingText && (
                <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3 mr-2 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-1 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                    Leo News AI Streaming Analysis…
                  </div>
                  <div className="whitespace-pre-wrap font-sans text-slate-200">{streamingText}</div>
                </div>
              )}

              {loading && !streamingText && (
                <div className="flex items-center gap-2 text-violet-300 text-xs py-2 animate-pulse">
                  <span>⚡ Analyzing breaking news, economic calendar & market reactions...</span>
                </div>
              )}

              <div ref={responseEndRef} />
            </div>
          )}

          {/* Custom Input Query Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void sendQuery()
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask News AI about breaking headlines, upcoming CPI/FOMC events, or market reactions for DOW, NQ, Gold, Crude..."
              disabled={loading}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50 transition"
            >
              Ask AI
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

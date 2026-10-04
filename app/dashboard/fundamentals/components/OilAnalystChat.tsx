'use client'

import React, { useState, useRef, useEffect } from 'react'
import type { WtiTelemetry } from '@/types/fundamentals'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface OilAnalystChatProps {
  telemetry: WtiTelemetry
}

const PRESET_QUERIES = [
  {
    id: 'cushing',
    label: '🛢️ Cushing Storage & Spread Audit',
    prompt:
      'Analyze the current Cushing OK hub inventory level (~23M bbl) and explain how operational tank bottoms impact prompt WTI backwardation.',
  },
  {
    id: 'opec-floor',
    label: '🏛️ OPEC+ Spare Capacity & Price Floor',
    prompt:
      'What is OPEC+ current spare capacity cushion and how reliably does the 2.2M bpd voluntary cut delay defend a $70-$75 WTI price floor?',
  },
  {
    id: 'crack-refinery',
    label: '⚙️ Refinery Runs & 3:2:1 Crack Margins',
    prompt:
      'Break down how current 91.8% refinery utilization and 3:2:1 crack spreads ($22.40/bbl) drive domestic crude absorption.',
  },
  {
    id: 'macro-cot',
    label: '📊 Speculative COT Positioning vs DXY',
    prompt:
      'Examine CFTC Managed Money net long positioning and assess vulnerability to macro US Dollar (DXY) and interest rate shocks.',
  },
]

export function OilAnalystChat({ telemetry }: OilAnalystChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const sendQuery = async (queryText?: string) => {
    const textToSend = (queryText || input).trim()
    if (!textToSend || loading) return

    const newMessages: Message[] = [...messages, { role: 'user', content: textToSend }]
    setMessages(newMessages)
    if (!queryText) setInput('')
    setLoading(true)
    setStreamingText('')

    try {
      const res = await fetch('/api/fundamentals/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
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
              /* ignore parse error on partial chunks */
            }
          }
        }
      }

      if (accumulated) {
        setMessages((prev) => [...prev, { role: 'assistant', content: accumulated }])
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Analyst connection error: ${err instanceof Error ? err.message : 'Failed to query analyst'}`,
        },
      ])
    } finally {
      setLoading(false)
      setStreamingText('')
    }
  }

  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl p-5 shadow-sm space-y-4 flex flex-col h-[650px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-700 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Oil Fundamental Analyst Terminal</h3>
            <p className="text-[11px] text-gray-400">
              Live consultation grounded in the 10 fundamental pillars and prompt WTI cash curve.
            </p>
          </div>
        </div>

        <div className="text-right font-mono text-[11px] text-gray-400">
          Prompt: <span className="text-white font-bold">${telemetry.promptPrice.toFixed(2)}</span> · Spread:{' '}
          <span className="text-brand-300 font-bold">
            {telemetry.promptSpread >= 0 ? '+' : ''}${telemetry.promptSpread.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Preset Queries Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 flex-shrink-0">
        {PRESET_QUERIES.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => sendQuery(q.prompt)}
            disabled={loading}
            className="px-2.5 py-1 text-xs rounded-lg bg-surface-700/80 hover:bg-surface-700 text-gray-300 hover:text-white border border-surface-600 transition whitespace-nowrap disabled:opacity-50"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Messages Thread Container */}
      <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs scrollbar-dark">
        {messages.length === 0 && !streamingText && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 space-y-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            <p className="font-semibold text-gray-400">Institutional Oil Fundamental Dialogue</p>
            <p className="max-w-md text-[11px]">
              Query the analyst regarding supply buffers, Cushing inventory bottlenecks, OPEC+ compliance, crack spreads, or term structure validation.
            </p>
          </div>
        )}

        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`p-3.5 rounded-xl ${
              m.role === 'user'
                ? 'bg-brand-600/15 border border-brand-500/30 text-gray-200 ml-8'
                : 'bg-surface-850 border border-surface-700 text-gray-200 mr-4'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5 text-gray-400 flex items-center justify-between">
              <span>{m.role === 'user' ? 'Desk Trader' : 'Oil Fundamental Analyst'}</span>
            </div>
            <div className="whitespace-pre-wrap leading-relaxed space-y-2">{m.content}</div>
          </div>
        ))}

        {streamingText && (
          <div className="p-3.5 rounded-xl bg-surface-850 border border-brand-500/30 text-gray-200 mr-4 animate-in fade-in">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5 text-brand-300">
              Oil Fundamental Analyst (Streaming...)
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{streamingText}</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Row */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          sendQuery()
        }}
        className="flex items-center gap-2 pt-2 border-t border-surface-700 flex-shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the Oil Fundamental Analyst anything about WTI supply, demand, inventories, or curves..."
          disabled={loading}
          className="flex-1 bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500 disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50 transition"
        >
          {loading ? 'Analyzing...' : 'Send'}
        </button>
      </form>
    </div>
  )
}

'use client'

import { useState } from 'react'

interface FoundLevel {
  level: number
  type: 'support' | 'resistance' | 'vwap'
  conviction: number
  reasoning: string
  timeframe: 'D' | '4H' | 'H1'
  is_duplicate: boolean
}

interface AnalysisResult {
  levels: FoundLevel[]
  session_id: string
  analysis_timestamp: string
  claude_usage: { input_tokens: number; output_tokens: number }
}

const TYPE_STYLES: Record<string, string> = {
  support:    'badge-up',
  resistance: 'badge-down',
  vwap:       'badge-warn',
}

const TF_COLORS: Record<string, string> = {
  D:  'text-purple-400',
  '4H': 'text-blue-400',
  H1: 'text-cyan-400',
}

const SAMPLE_CANDLE = (price: number, i: number) => ({
  open: price + (Math.random() - 0.5) * 50,
  high: price + Math.random() * 80,
  low: price - Math.random() * 80,
  close: price + (Math.random() - 0.5) * 50,
  volume: Math.floor(Math.random() * 1000000) + 500000,
  timestamp: new Date(Date.now() - i * 3600000 * 4).toISOString(),
})

function generateSampleCandles(basePrice: number, count: number) {
  return Array.from({ length: count }, (_, i) => SAMPLE_CANDLE(basePrice, i)).reverse()
}

export default function AIAgentPage() {
  const [form, setForm] = useState({
    session_id: '',
    symbol: 'YM=F',
    index: 'DOW' as 'DOW' | 'NASDAQ',
    current_price: '',
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [useSampleData, setUseSampleData] = useState(true)

  async function runAnalysis(e: React.FormEvent) {
    e.preventDefault()
    setRunning(true)
    setResult(null)
    setError(null)

    const price = parseFloat(form.current_price)

    // Build candle data
    const candles_4h    = generateSampleCandles(price, 30)
    const candles_daily = generateSampleCandles(price, 10)
    const candles_h1    = generateSampleCandles(price, 12)

    try {
      const res = await fetch('/api/agents/find-levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: form.session_id,
          symbol: form.symbol,
          index: form.index,
          current_price: price,
          candles_4h,
          candles_daily,
          candles_h1,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult(json)
      } else {
        setError(json.error ?? 'Analysis failed')
      }
    } catch (e: any) {
      setError(e.message ?? 'Network error')
    }
    setRunning(false)
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">AI Level Finder</h1>
        <p className="text-sm text-gray-500 mt-1">
          Claude AI analyzes multi-timeframe price action to identify key support &amp; resistance levels
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: '📊', title: 'Multi-TF Analysis', desc: 'Processes Daily, 4H, and 1H candles simultaneously' },
          { icon: '🧠', title: 'Claude AI', desc: 'Claude identifies levels using price action methodology' },
          { icon: '💾', title: 'Auto-Store', desc: 'Levels are validated and saved to your session history' },
        ].map(f => (
          <div key={f.title} className="card-sm p-4 flex gap-3">
            <div className="text-2xl">{f.icon}</div>
            <div>
              <div className="text-sm font-semibold text-white">{f.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Analysis form */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Run Analysis</h2>
        <form onSubmit={runAnalysis} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="stat-label block mb-1">Session ID</label>
              <input
                required className="w-full bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 transition"
                placeholder="session-uuid"
                value={form.session_id}
                onChange={e => setForm(f => ({ ...f, session_id: e.target.value }))}
              />
            </div>
            <div>
              <label className="stat-label block mb-1">Index</label>
              <select
                className="w-full bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 transition"
                value={form.index}
                onChange={e => {
                  const idx = e.target.value as 'DOW' | 'NASDAQ'
                  setForm(f => ({ ...f, index: idx, symbol: idx === 'DOW' ? 'YM=F' : 'NQ=F' }))
                }}
              >
                <option value="DOW">DOW (YM=F)</option>
                <option value="NASDAQ">NASDAQ (NQ=F)</option>
              </select>
            </div>
            <div>
              <label className="stat-label block mb-1">Current Price</label>
              <input
                required type="number" step="any"
                className="w-full bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white price-mono focus:outline-none focus:border-brand-500 transition"
                placeholder={form.index === 'DOW' ? '39500' : '17800'}
                value={form.current_price}
                onChange={e => setForm(f => ({ ...f, current_price: e.target.value }))}
              />
            </div>
            <div className="flex flex-col justify-end">
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setUseSampleData(v => !v)}
                  className={`w-9 h-5 rounded-full transition-colors duration-200 flex items-center ${useSampleData ? 'bg-brand-600 justify-end' : 'bg-surface-600 justify-start'}`}
                >
                  <span className="w-4 h-4 bg-white rounded-full mx-0.5 shadow" />
                </button>
                <label className="text-xs text-gray-400">Auto-generate candles</label>
              </div>
            </div>
          </div>

          {!useSampleData && (
            <div className="p-4 rounded-xl bg-yellow-900/20 border border-yellow-700/40 text-sm text-yellow-300">
              ℹ️ Manual candle input is available via the API. Enable "Auto-generate candles" to use sample data for testing.
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={running || !useSampleData}
              className="btn-primary"
            >
              {running ? (
                <><span className="animate-spin inline-block mr-1">⟳</span> Analyzing with Claude…</>
              ) : (
                '🧠 Run AI Analysis'
              )}
            </button>
            {running && (
              <span className="text-xs text-gray-500 animate-pulse">
                This may take 30–60 seconds…
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="card p-5 bg-red-900/20 border-red-700/40 text-red-400 flex gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <div className="font-semibold">Analysis failed</div>
            <div className="text-sm mt-0.5 text-red-300">{error}</div>
            {error.toLowerCase().includes('unauthorized') && (
              <div className="text-xs text-gray-500 mt-1">Authentication required — login to use the AI agent</div>
            )}
            {error.toLowerCase().includes('claude') && (
              <div className="text-xs text-gray-500 mt-1">Add your ANTHROPIC_API_KEY to .env.local</div>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4 animate-slide-up">
          {/* Header stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="stat-block">
              <div className="stat-label">Levels Found</div>
              <div className="stat-value text-white">{result.levels.length}</div>
            </div>
            <div className="stat-block">
              <div className="stat-label">Duplicates Skipped</div>
              <div className="stat-value text-yellow-400">{result.levels.filter(l => l.is_duplicate).length}</div>
            </div>
            <div className="stat-block">
              <div className="stat-label">Input Tokens</div>
              <div className="stat-value text-gray-400 text-base">{result.claude_usage.input_tokens.toLocaleString()}</div>
            </div>
            <div className="stat-block">
              <div className="stat-label">Output Tokens</div>
              <div className="stat-value text-gray-400 text-base">{result.claude_usage.output_tokens.toLocaleString()}</div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-600 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Identified Levels</h2>
              <span className="text-xs text-gray-600">
                {new Date(result.analysis_timestamp).toLocaleTimeString()}
              </span>
            </div>
            {result.levels.length === 0 ? (
              <div className="p-12 text-center text-gray-600">No levels identified</div>
            ) : (
              <div className="divide-y divide-surface-700/50">
                {result.levels
                  .sort((a, b) => b.conviction - a.conviction)
                  .map((level, i) => (
                    <div key={i} className={`px-6 py-4 hover:bg-surface-700/30 transition ${level.is_duplicate ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="price-mono text-xl font-bold text-white w-28">
                          {level.level.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                        </span>
                        <span className={`badge ${TYPE_STYLES[level.type]}`}>{level.type}</span>
                        <span className={`badge badge-neutral ${TF_COLORS[level.timeframe]}`}>{level.timeframe}</span>

                        {/* Conviction */}
                        <div className="flex items-center gap-1.5">
                          {Array.from({ length: 10 }, (_, j) => (
                            <div
                              key={j}
                              className={`w-2.5 h-2.5 rounded-sm transition-colors ${
                                j < level.conviction
                                  ? level.conviction >= 7 ? 'bg-green-500'
                                    : level.conviction >= 4 ? 'bg-yellow-500' : 'bg-red-500'
                                  : 'bg-surface-600'
                              }`}
                            />
                          ))}
                          <span className="text-xs text-gray-500 ml-1">{level.conviction}/10</span>
                        </div>

                        {level.is_duplicate && (
                          <span className="badge badge-neutral text-yellow-600">duplicate</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-2 leading-relaxed">{level.reasoning}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

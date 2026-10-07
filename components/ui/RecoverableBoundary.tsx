'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '@/lib/client/reportClientError'

const DRAWING_KEYS = [
  'trading_desk_trendlines_v1',
  'trading_desk_ranges_v1',
  'trading_desk_frvps_v1',
  'trading_desk_measures_v1',
  'tradepulse.desk.managePos',
  'tradepulse.desk.positionOverlay',
  'tradepulse.desk.pendingLimit',
]

function clearSavedDeskState(): void {
  try {
    for (const key of DRAWING_KEYS) localStorage.removeItem(key)
    const highlightKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('desk_saved_highlights_')) highlightKeys.push(key)
    }
    for (const key of highlightKeys) localStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}

/**
 * Keeps a desk panel crash on that panel. The Next.js root boundary
 * otherwise replaces the whole site with "Application error".
 */
export class RecoverableBoundary extends Component<
  { children: ReactNode; label: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  private retried = false

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack)
    reportClientError(error, this.props.label)
    if (this.retried) return
    this.retried = true
    // One automatic remount. A deterministic throw stays visible below.
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const message = this.state.error.message || 'Unknown error'
    return (
      <div className="m-2 rounded-lg border border-red-700/50 bg-[#1c1214] px-3 py-3 text-sm text-red-100">
        <p className="font-semibold text-red-200">
          {this.props.label} stopped. The rest of the desk is still open.
        </p>
        <p className="mt-2 break-all font-mono text-xs text-red-100/90">{message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
          <button
            type="button"
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/5"
            onClick={() => {
              clearSavedDeskState()
              window.location.reload()
            }}
          >
            Clear saved chart data and reload
          </button>
        </div>
      </div>
    )
  }
}

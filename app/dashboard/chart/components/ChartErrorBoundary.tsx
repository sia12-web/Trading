'use client'

import React, { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ChartErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ChartErrorBoundary] Intercepted client-side exception:', error, errorInfo)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  private handleResetCache = () => {
    try {
      if (typeof window !== 'undefined') {
        const keysToRemove = [
          'trading_desk_trendlines_v1',
          'trading_desk_ranges_v1',
          'trading_desk_frvps_v1',
          'trading_desk_measures_v1',
          'desk_saved_highlights_DOW',
          'desk_saved_highlights_NASDAQ',
          'desk_saved_highlights_GOLD',
          'desk_saved_highlights_CRUDE',
          'desk_saved_highlights_SILVER',
          'desk_saved_highlights_NIKKEI',
        ]
        keysToRemove.forEach((k) => window.localStorage.removeItem(k))
      }
    } catch {
      /* ignore */
    }
    this.setState({ hasError: false, error: null })
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#0d1117] p-6 text-white select-none">
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-[#161b22] p-6 shadow-2xl backdrop-blur-md space-y-4 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xl font-bold">
              ⚠️
            </div>
            <h3 className="text-base font-bold text-gray-100">
              {this.props.fallbackTitle || 'Trading Chart Recovery Mode'}
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              A client-side layout condition was intercepted. Your underlying broker connections, order risk limits, and telemetry remain fully intact.
            </p>
            {this.state.error?.message && (
              <div className="rounded-lg bg-black/50 border border-neutral-800 p-2.5 text-left">
                <p className="font-mono text-[11px] text-amber-300 break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-md transition active:scale-95"
              >
                Reload Component
              </button>
              <button
                type="button"
                onClick={this.handleResetCache}
                className="rounded-lg border border-neutral-700 hover:border-neutral-500 bg-[#21262d] px-4 py-2 text-xs font-semibold text-gray-300 hover:text-white shadow-md transition active:scale-95"
              >
                Reset Saved Layout
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

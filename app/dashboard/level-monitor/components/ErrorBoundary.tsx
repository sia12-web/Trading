'use client'

import React, { Component, ReactNode } from 'react'
import { logger } from '@/lib/utils/logger'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="card p-8 text-center">
            <div className="text-red-400 font-semibold mb-2">Something went wrong</div>
            <div className="text-gray-500 text-sm mb-4">{this.state.error?.message}</div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm transition"
            >
              Retry
            </button>
          </div>
        )
      )
    }

    return this.props.children
  }
}

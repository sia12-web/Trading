/**
 * Connection Manager
 * Handles Realtime connection resilience, reconnection logic, and fallback strategies
 */

export type ConnectionState =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'
  | 'offline'

export interface ConnectionStatus {
  state: ConnectionState
  isHealthy: boolean
  lastUpdate: Date | null
  errorMessage: string | null
  retryCount: number
  nextRetryAt: Date | null
}

interface ReconnectConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
}

const DEFAULT_CONFIG: ReconnectConfig = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
}

export class ConnectionManager {
  private state: ConnectionState = 'disconnected'
  private retryCount: number = 0
  private nextRetryAt: Date | null = null
  private retryTimerId: NodeJS.Timeout | null = null
  private statusCallbacks: Set<(status: ConnectionStatus) => void> = new Set()
  private errorCallbacks: Set<(error: Error) => void> = new Set()
  private reconnectCallbacks: Set<() => void> = new Set()
  private config: ReconnectConfig = DEFAULT_CONFIG

  /**
   * Register callback for status changes
   */
  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }

  /**
   * Register callback for errors
   */
  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }

  /**
   * Register callback for when a reconnect attempt should be made
   */
  onReconnectNeeded(callback: () => void): () => void {
    this.reconnectCallbacks.add(callback)
    return () => this.reconnectCallbacks.delete(callback)
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return {
      state: this.state,
      isHealthy: this.state === 'connected',
      lastUpdate: new Date(),
      errorMessage: this.state === 'failed' ? 'Connection failed' : null,
      retryCount: this.retryCount,
      nextRetryAt: this.nextRetryAt,
    }
  }

  /**
   * Mark connection as connected
   */
  markConnected(): void {
    this.setState('connected')
    this.retryCount = 0
    this.nextRetryAt = null
    this.notifyStatusChange()
  }

  /**
   * Mark connection as connecting
   */
  markConnecting(): void {
    this.setState('connecting')
    this.notifyStatusChange()
  }

  /**
   * Mark connection as failed and schedule retry
   */
  markFailed(error: Error): void {
    this.setState('reconnecting')
    this.retryCount++

    if (this.retryCount >= this.config.maxRetries) {
      this.setState('failed')
      this.errorCallbacks.forEach((cb) => cb(error))
    } else {
      const delay = this.calculateBackoff(this.retryCount)
      this.nextRetryAt = new Date(Date.now() + delay)
      this.scheduleRetry(delay)
    }

    this.notifyStatusChange()
  }

  /**
   * Attempt to recover connection
   */
  markRecovering(): void {
    if (this.state === 'failed') {
      this.setState('reconnecting')
      this.retryCount = 0
      this.nextRetryAt = null
      this.notifyStatusChange()
    }
  }

  /**
   * Mark connection as disconnected (intentional)
   */
  markDisconnected(): void {
    this.setState('disconnected')
    this.retryCount = 0
    this.nextRetryAt = null
    this.notifyStatusChange()
  }

  /**
   * Check if currently offline
   */
  isOffline(): boolean {
    if (typeof window === 'undefined') return false // SSR, assume online
    if (typeof navigator === 'undefined') return false // Fallback
    return !navigator.onLine
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attemptNumber: number): number {
    const baseDelay = Math.min(
      this.config.initialDelayMs * Math.pow(2, attemptNumber - 1),
      this.config.maxDelayMs
    )
    const jitter = Math.random() * 500 // 0-500ms jitter
    return baseDelay + jitter
  }

  /**
   * Schedule a retry attempt
   */
  private scheduleRetry(delayMs: number): void {
    if (this.retryTimerId) {
      clearTimeout(this.retryTimerId)
    }
    this.retryTimerId = setTimeout(() => {
      // Fire reconnect callbacks so subscribers can re-establish connections
      this.reconnectCallbacks.forEach((cb) => cb())
      this.retryTimerId = null
    }, delayMs)
  }

  /**
   * Update internal state
   */
  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState
    }
  }

  /**
   * Notify all listeners of status change
   */
  private notifyStatusChange(): void {
    const status = this.getStatus()
    this.statusCallbacks.forEach((cb) => cb(status))
  }

  /**
   * Reset connection state
   */
  reset(): void {
    if (this.retryTimerId) {
      clearTimeout(this.retryTimerId)
      this.retryTimerId = null
    }
    this.state = 'disconnected'
    this.retryCount = 0
    this.nextRetryAt = null
  }
}

// Singleton instance
let connectionManagerInstance: ConnectionManager | null = null

export function getConnectionManager(): ConnectionManager {
  if (!connectionManagerInstance) {
    connectionManagerInstance = new ConnectionManager()
  }
  if (!connectionManagerInstance) {
    throw new Error('Failed to initialize ConnectionManager')
  }
  return connectionManagerInstance
}

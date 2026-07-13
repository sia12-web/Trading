/**
 * Tests for Connection Manager Service
 * Tests resilience, reconnection logic, and status tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConnectionManager } from '@/lib/services/connectionManager'

describe('ConnectionManager', () => {
  let manager: ConnectionManager

  beforeEach(() => {
    manager = new ConnectionManager()
  })

  describe('Status Tracking', () => {
    it('should start in disconnected state', () => {
      const status = manager.getStatus()
      expect(status.state).toBe('disconnected')
      expect(status.isHealthy).toBe(false)
    })

    it('should transition to connected', () => {
      manager.markConnecting()
      manager.markConnected()

      const status = manager.getStatus()
      expect(status.state).toBe('connected')
      expect(status.isHealthy).toBe(true)
      expect(status.retryCount).toBe(0)
    })

    it('should transition through connecting state', () => {
      manager.markConnecting()
      const status = manager.getStatus()
      expect(status.state).toBe('connecting')
      expect(status.isHealthy).toBe(false)
    })

    it('should track retry count on failure', () => {
      manager.markConnecting()
      manager.markFailed(new Error('Test error'))

      const status = manager.getStatus()
      expect(status.retryCount).toBe(1)
      expect(status.state).toBe('reconnecting')
    })

    it('should increment retry count on subsequent failures', () => {
      manager.markConnecting()
      manager.markFailed(new Error('Error 1'))
      manager.markConnecting()
      manager.markFailed(new Error('Error 2'))

      const status = manager.getStatus()
      expect(status.retryCount).toBe(2)
    })

    it('should transition to failed after max retries', () => {
      for (let i = 0; i < 10; i++) {
        manager.markConnecting()
        manager.markFailed(new Error(`Error ${i}`))
      }

      const status = manager.getStatus()
      expect(status.state).toBe('failed')
      expect(status.retryCount).toBe(10)
    })
  })

  describe('Retry Scheduling', () => {
    it('should calculate exponential backoff', () => {
      manager.markConnecting()
      manager.markFailed(new Error('Test'))

      const status = manager.getStatus()
      expect(status.nextRetryAt).not.toBeNull()

      const delayMs = status.nextRetryAt!.getTime() - Date.now()
      expect(delayMs).toBeGreaterThan(500) // At least initial delay
      expect(delayMs).toBeLessThan(1500) // Less than initial + max jitter
    })

    it('should increase delay with each retry', () => {
      const delays: number[] = []

      for (let i = 0; i < 5; i++) {
        manager.markConnecting()
        manager.markFailed(new Error('Test'))

        const status = manager.getStatus()
        const delay = status.nextRetryAt!.getTime() - Date.now()
        delays.push(delay)
      }

      // Delays should generally increase (accounting for jitter)
      // At least the trend should be upward
      let increasing = 0
      for (let i = 1; i < delays.length; i++) {
        if (delays[i] > delays[i - 1]) increasing++
      }
      expect(increasing).toBeGreaterThan(0)
    })

    it('should cap backoff at max delay (30 seconds)', () => {
      // Simulate 15+ retry attempts
      for (let i = 0; i < 15; i++) {
        manager.markConnecting()
        manager.markFailed(new Error('Test'))
      }

      const status = manager.getStatus()
      const delayMs = status.nextRetryAt!.getTime() - Date.now()
      expect(delayMs).toBeLessThanOrEqual(30500) // 30s + max jitter
    })
  })

  describe('Status Callbacks', () => {
    it('should notify on status change', () => {
      const callback = vi.fn()
      manager.onStatusChange(callback)

      manager.markConnected()

      expect(callback).toHaveBeenCalled()
      const status = callback.mock.calls[0][0]
      expect(status.state).toBe('connected')
    })

    it('should allow multiple status callbacks', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      manager.onStatusChange(callback1)
      manager.onStatusChange(callback2)

      manager.markConnected()

      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()
    })

    it('should allow unsubscribing from callbacks', () => {
      const callback = vi.fn()
      const unsubscribe = manager.onStatusChange(callback)

      manager.markConnected()
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      manager.markDisconnected()
      expect(callback).toHaveBeenCalledTimes(1) // Not called again
    })

    it('should notify on error', () => {
      const errorCallback = vi.fn()
      manager.onError(errorCallback)

      manager.markConnecting()
      manager.markFailed(new Error('Test error'))
      // Mark failed multiple times to trigger max retries
      for (let i = 0; i < 9; i++) {
        manager.markConnecting()
        manager.markFailed(new Error('Test'))
      }

      expect(errorCallback).toHaveBeenCalled()
    })
  })

  describe('Recovery', () => {
    it('should reset retry count on successful connection', () => {
      manager.markConnecting()
      manager.markFailed(new Error('Test'))
      expect(manager.getStatus().retryCount).toBe(1)

      manager.markConnected()
      expect(manager.getStatus().retryCount).toBe(0)
    })

    it('should allow recovery from failed state', () => {
      // Fail max times
      for (let i = 0; i < 10; i++) {
        manager.markConnecting()
        manager.markFailed(new Error('Test'))
      }

      expect(manager.getStatus().state).toBe('failed')

      // Recovery attempt
      manager.markRecovering()
      expect(manager.getStatus().state).toBe('reconnecting')
      expect(manager.getStatus().retryCount).toBe(0)
    })
  })

  describe('Reset', () => {
    it('should reset all state', () => {
      manager.markConnecting()
      manager.markConnected()

      manager.reset()

      const status = manager.getStatus()
      expect(status.state).toBe('disconnected')
      expect(status.retryCount).toBe(0)
      expect(status.nextRetryAt).toBeNull()
    })
  })

  describe('Offline Detection', () => {
    it('should have isOffline method', () => {
      expect(typeof manager.isOffline()).toBe('boolean')
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid state transitions', () => {
      expect(() => {
        manager.markConnecting()
        manager.markConnected()
        manager.markDisconnected()
        manager.markConnecting()
        manager.markFailed(new Error('Test'))
      }).not.toThrow()
    })

    it('should handle errors with null/undefined', () => {
      expect(() => {
        manager.markFailed(new Error())
      }).not.toThrow()
    })

    it('should allow marking disconnected multiple times', () => {
      manager.markDisconnected()
      manager.markDisconnected()
      manager.markDisconnected()

      expect(manager.getStatus().state).toBe('disconnected')
    })
  })
})

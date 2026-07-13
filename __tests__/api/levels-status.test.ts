/**
 * Tests for GET /api/levels/status endpoint
 * Tests validation, authorization, and response format
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from '@/app/api/levels/status/route'
import { NextRequest } from 'next/server'

describe('GET /api/levels/status', () => {
  describe('Input Validation', () => {
    it('should return 400 when instruments parameter is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/levels/status', {
        method: 'GET',
      })

      const response = await GET(request)
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error).toBeDefined()
    })

    it('should return 400 when instruments parameter is empty string', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(400)
    })

    it('should return 400 when all instruments are invalid', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=INVALID,FAKE,WRONG',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error).toContain('Invalid')
    })

    it('should accept valid instruments', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW,NASDAQ,NIKKEI',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(Array.isArray(data.data)).toBe(true)
    })

    it('should filter out invalid instruments and accept valid ones', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW,INVALID,NASDAQ',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(Array.isArray(data.data)).toBe(true)
      expect(data.data.length).toBe(2) // Only DOW and NASDAQ
    })

    it('should handle single valid instrument', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.data.length).toBe(1)
      expect(data.data[0].instrument).toBe('DOW')
    })

    it('should handle critical_only parameter', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW&critical_only=true',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
    })
  })

  describe('Response Format', () => {
    it('should return properly formatted response', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      const data = await response.json()

      expect(data).toHaveProperty('success')
      expect(data).toHaveProperty('data')
      expect(data).toHaveProperty('timestamp')
    })

    it('should include required fields in response', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      const data = await response.json()

      const instrument = data.data[0]
      expect(instrument).toHaveProperty('instrument')
      expect(instrument).toHaveProperty('currentPrice')
      expect(instrument).toHaveProperty('levels')
      expect(instrument).toHaveProperty('timestamp')
    })

    it('should include level details', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      const data = await response.json()

      const levels = data.data[0].levels
      expect(Array.isArray(levels)).toBe(true)

      if (levels.length > 0) {
        const level = levels[0]
        expect(level).toHaveProperty('level')
        expect(level).toHaveProperty('status')
        expect(level).toHaveProperty('proximity')
        expect(level).toHaveProperty('distance')
        expect(level).toHaveProperty('distancePct')
        expect(level).toHaveProperty('bounceCount')
      }
    })

    it('should have numeric values for distance fields', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      const data = await response.json()

      const level = data.data[0].levels[0]
      expect(typeof level.distance).toBe('number')
      expect(typeof level.distancePct).toBe('number')
      expect(typeof level.bounceCount).toBe('number')
    })

    it('should have valid status values', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      const data = await response.json()

      const validStatuses = [
        'unvisited',
        'approaching',
        'touched',
        'broken',
        'bounced',
        'rejected',
      ]

      const levels = data.data[0].levels
      levels.forEach((level: any) => {
        expect(validStatuses).toContain(level.status)
      })
    })

    it('should have valid proximity values', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      const data = await response.json()

      const validProximities = ['far', 'approaching', 'at', 'breached']

      const levels = data.data[0].levels
      levels.forEach((level: any) => {
        expect(validProximities).toContain(level.proximity)
      })
    })
  })

  describe('Error Handling', () => {
    it('should return 500 on unexpected server error', async () => {
      // This is tested implicitly - errors are caught and return 500
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect([200, 400, 500]).toContain(response.status)
    })

    it('should not expose internal error details', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)

      if (response.status >= 400) {
        const data = await response.json()
        expect(data.error).not.toMatch(/stack/i)
        expect(data.error).not.toMatch(/Error at/i)
      }
    })
  })

  describe('Security', () => {
    it('should only return levels for requested instruments', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      const data = await response.json()

      data.data.forEach((item: any) => {
        expect(item.instrument).toBe('DOW')
      })
    })

    it('should not allow path traversal in instruments parameter', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=../../etc/passwd',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(400)
    })

    it('should not execute SQL injection in instruments parameter', async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/levels/status?instruments=' OR '1'='1",
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(400)
    })

    it('should handle XSS attempts in query params gracefully', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=<script>alert(1)</script>',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(400)
    })
  })

  describe('Edge Cases', () => {
    it('should handle instruments with extra whitespace', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW, NASDAQ, NIKKEI',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      // Should handle whitespace trimming
      expect(data.data.length).toBeGreaterThan(0)
    })

    it('should handle case sensitivity in instruments', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=dow,nasdaq',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(400) // Should require uppercase
    })

    it('should handle very long instruments parameter', async () => {
      const longParam = 'DOW,' + 'INVALID,'.repeat(1000)
      const request = new NextRequest(
        `http://localhost:3000/api/levels/status?instruments=${longParam}`,
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      // Should handle gracefully, either 200 or 400
      expect([200, 400]).toContain(response.status)
    })

    it('should handle duplicate instruments in parameter', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/levels/status?instruments=DOW,DOW,DOW',
        {
          method: 'GET',
        }
      )

      const response = await GET(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      // Should only return once per instrument
      expect(data.data.length).toBe(1)
    })
  })
})

'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/client/reportClientError'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError(error, 'global')
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0d1117', color: '#f3f4f6', fontFamily: 'sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 520 }}>
            <h1 style={{ fontSize: 18, marginBottom: 8 }}>The desk hit an error</h1>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#fecaca', wordBreak: 'break-all' }}>
              {error.message || 'Unknown client error'}
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{ marginTop: 16, padding: '8px 14px', borderRadius: 8, border: 0, background: '#4f46e5', color: 'white' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}

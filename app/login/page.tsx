'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  if (raw.startsWith('/login')) return '/dashboard'
  return raw
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(json.error || (res.status === 429 ? 'Too many attempts — wait and try again' : 'Login failed'))
        return
      }
      router.replace(safeNext(searchParams.get('next')))
      router.refresh()
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label htmlFor="desk-password" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          Password
        </label>
        <input
          id="desk-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2.5 text-sm text-gray-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          placeholder="Desk password"
          disabled={loading}
        />
      </div>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Signing in…' : 'Enter desk'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface-900">
      <div className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-brand-900/50">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path
              d="M3 17l6-6 4 4 8-9"
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <div className="text-lg font-bold text-white leading-none">TradePulse</div>
          <div className="text-xs text-gray-500 mt-1">Sign in to continue</div>
        </div>
      </div>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}

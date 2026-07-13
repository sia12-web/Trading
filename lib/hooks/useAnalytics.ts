'use client'

import useSWR from 'swr'
import type { AnalyticsResponse, Instrument } from '@/types/analytics'

const fetcher = async (url: string): Promise<AnalyticsResponse> => {
  const response = await fetch(url)

  if (!response.ok) {
    try {
      const error = await response.json()
      throw new Error(error.error || `Failed to fetch analytics (${response.status})`)
    } catch {
      throw new Error(`Failed to fetch analytics (${response.status})`)
    }
  }

  try {
    return await response.json()
  } catch (err) {
    throw new Error('Invalid response format from analytics API')
  }
}

export function useAnalytics(instrument: Instrument | null, days: number) {
  const url = instrument
    ? `/api/levels/analytics?instrument=${instrument}&days=${days}`
    : null

  const { data, error, isLoading, mutate } = useSWR<AnalyticsResponse, Error>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60000, // 1 minute
      focusThrottleInterval: 300000, // 5 minutes
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 5000,
    }
  )

  return {
    data,
    error,
    isLoading,
    mutate,
  }
}

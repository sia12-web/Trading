'use client'

import type { AvailableDate } from '@/types/trading'

interface AvailabilityBadgeProps {
  date: AvailableDate
  isLoading?: boolean
}

export function AvailabilityBadge({ date, isLoading }: AvailabilityBadgeProps) {
  if (isLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-gray-500 text-lg">❓</div>
      </div>
    )
  }

  if (date.has_session) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-orange-400 text-lg" title="Replay session exists for this date">
          🔄
        </div>
      </div>
    )
  }

  if (!date.is_available) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-gray-600 text-lg" title="No market data available">
          ❌
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-green-400 text-lg" title="Data available">
        ✅
      </div>
    </div>
  )
}

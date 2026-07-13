import { LevelMonitorWidget } from './components/LevelMonitorWidget'

export const metadata = {
  title: 'Level Monitoring | Trading Platform',
  description: 'Real-time level monitoring for DOW, NASDAQ, and NIKKEI',
}

export default async function LevelMonitorPage() {
  try {
    // Fetch initial level status from API
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
    const res = await fetch(`${apiUrl}/api/levels/status?instruments=DOW,NASDAQ,NIKKEI`, {
      cache: 'no-store', // Always fresh data
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch level status: ${res.status}`)
    }

    const data = await res.json()
    const initialData = data.data || []

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Level Monitoring</h1>
            <p className="text-gray-600">
              Real-time tracking of key support and resistance levels
            </p>
          </header>

          <LevelMonitorWidget initialData={initialData} />
        </div>
      </div>
    )
  } catch (error) {
    console.error('[Level Monitor Page] Error fetching initial data:', error)

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Level Monitoring</h1>
            <p className="text-gray-600">
              Real-time tracking of key support and resistance levels
            </p>
          </header>

          <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
            <div className="text-red-800 font-semibold mb-2">Failed to Load Level Data</div>
            <div className="text-red-700 text-sm mb-4">
              Unable to fetch initial level status. Please try refreshing the page.
            </div>
          </div>
        </div>
      </div>
    )
  }
}

'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isFullBleedDesk =
    pathname === '/dashboard/chart' ||
    pathname?.startsWith('/dashboard/chart/') ||
    pathname?.startsWith('/dashboard/simulation/replay/')

  // Chart / sim replay desk: full-bleed, no left nav
  if (isFullBleedDesk) {
    return (
      <div className="h-screen max-h-screen bg-surface-900 overflow-hidden">
        {children}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-60 min-h-screen bg-surface-900 scrollbar-dark overflow-y-auto">
        {children}
      </main>
    </div>
  )
}

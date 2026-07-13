import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard | Trading Platform',
  description: 'Level analytics and performance dashboard',
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

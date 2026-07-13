import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trading Platform',
  description: 'Real-time level monitoring and price tracking for DOW, NASDAQ, NIKKEI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

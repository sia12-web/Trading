import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trading Platform — Level Monitor',
  description: 'Real-time support & resistance level tracking for DOW, NASDAQ, NIKKEI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-surface-900 text-gray-100 font-sans antialiased">
        {children}
      </body>
    </html>
  )
}

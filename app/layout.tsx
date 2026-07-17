import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'TradePulse — Level Intelligence',
  description: 'AI-powered real-time support & resistance tracking for DOW, NASDAQ, NIKKEI',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-surface-900 text-gray-100 font-sans antialiased">
        {children}
      </body>
    </html>
  )
}

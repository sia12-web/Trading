import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'TradePulse',
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
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('error',function(e){try{var m=(e&&e.message)||'';if(!m||m==='Script error.')return;fetch('/api/client-error',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({message:String(m).slice(0,500),stack:String((e.error&&e.error.stack)||'').slice(0,2000),label:'window',href:location.href.slice(0,300)})})}catch(x){}})",
          }}
        />
        {children}
      </body>
    </html>
  )
}

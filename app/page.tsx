import { redirect } from 'next/navigation'
import { isAnyLiveFocusWindowActive } from '@/lib/trading/sessionGate'

export default function HomePage() {
  // Live focus (−30m → cash close) → chart; otherwise desk home
  if (isAnyLiveFocusWindowActive()) {
    redirect('/dashboard/chart')
  }
  redirect('/dashboard')
}

import { redirect } from 'next/navigation'

/** Sim history now lives under Order History → Simulation tab. */
export default function SimHistoryRedirectPage() {
  redirect('/dashboard/journal?tab=sim')
}

import { redirect } from 'next/navigation'

/** Simulation is not on the live product. */
export default function SimHistoryRedirectPage() {
  redirect('/dashboard/journal')
}

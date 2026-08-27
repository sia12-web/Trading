import { redirect } from 'next/navigation'

/** Simulation is not on the live product. Replay desk kept for tests. */
export default function SimulationPage() {
  redirect('/dashboard/chart')
}

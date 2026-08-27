import { redirect } from 'next/navigation'

/** Simulation is not on the live product. Page source kept for tests. */
export default function SimulationReplayLayout() {
  redirect('/dashboard/chart')
}

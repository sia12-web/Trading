import { redirect } from 'next/navigation'

/** Simulation charts are removed — live desk only. */
export default function SimulationReplayDeskPage() {
  redirect('/dashboard/chart')
}

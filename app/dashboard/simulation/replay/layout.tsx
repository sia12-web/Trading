/**
 * Full-viewport replay desk — no dashboard chrome, no page scroll.
 */
export default function SimulationReplayLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col h-screen max-h-screen w-screen overflow-hidden bg-[#0d1117]">
      {children}
    </div>
  )
}

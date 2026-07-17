/**
 * Chart-specific layout override.
 * Removes the default `overflow-y-auto` from the main wrapper so the chart
 * can use `h-screen` and fill the entire viewport without any scroll.
 */
export default function ChartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {children}
    </div>
  )
}

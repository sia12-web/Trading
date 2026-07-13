import { Sidebar } from './Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-60 min-h-screen bg-surface-900 scrollbar-dark overflow-y-auto">
        {children}
      </main>
    </div>
  )
}

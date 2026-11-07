import type { ReactNode } from 'react'
import Shell from '../../components/Shell'
import { WorkspaceProvider } from '../../components/WorkspaceProvider'
import { loadInitial } from '../../lib/workspace.server'

// Data is read per request (endpoint or private folder), never baked into the build.
export const dynamic = 'force-dynamic'

/** Server Component: loads the workspace on the server, then hands it to the interactive client shell. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const initial = await loadInitial()
  return (
    <WorkspaceProvider initial={initial}>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  )
}

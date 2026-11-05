import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import Shell from '../components/Shell'
import { WorkspaceProvider } from '../components/WorkspaceProvider'
import { loadInitial } from '../lib/workspace.server'
import './globals.css'

// Data is read per request (endpoint or private folder), never baked into the build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Growth OS' }
export const viewport: Viewport = { themeColor: '#07080b' }

/** Server Component: loads the workspace on the server, then hands it to the interactive client shell. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const initial = await loadInitial()
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider initial={initial}>
          <Shell>{children}</Shell>
        </WorkspaceProvider>
      </body>
    </html>
  )
}

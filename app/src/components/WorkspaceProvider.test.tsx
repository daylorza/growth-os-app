// @vitest-environment jsdom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import Goals from '../modules/Goals'
import type { InitialData } from '../lib/store'
import { WorkspaceProvider } from './WorkspaceProvider'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => vi.useRealTimers())

// The browser's date differs from the server's: a visitor in another timezone, or a page rendered just before midnight.
it('hydrates without a mismatch when the browser is already on the next day, then shows the browser date', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 8, 23, 30))
  const initial: InitialData = { mode: 'local', private: {}, today: '2026-11-08' }
  const app = (
    <WorkspaceProvider initial={initial}>
      <Goals />
    </WorkspaceProvider>
  )
  const container = document.createElement('div')
  container.innerHTML = renderToString(app)
  expect(container.textContent).toContain('Nov 8')

  vi.setSystemTime(new Date(2026, 10, 9, 0, 30))
  const errors: unknown[] = []
  await act(async () => {
    hydrateRoot(container, app, { onRecoverableError: (e) => errors.push(e) })
  })
  expect(errors).toEqual([])
  expect(container.textContent).toContain('Nov 9')
})

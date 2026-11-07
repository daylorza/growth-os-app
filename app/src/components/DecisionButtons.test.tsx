// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DecisionButtons } from './DecisionButtons'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../lib/store', () => ({ refresh: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('submits the inline change request and preserves its note', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', request)
  render(<DecisionButtons id="C-1" state="open" />)
  fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Shorten the opening' } })
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Submit changes' }))
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ decision: 'request_changes', note: 'Shorten the opening' })
})

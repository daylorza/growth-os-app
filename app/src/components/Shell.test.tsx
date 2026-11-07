// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSampleSeed } from '../lib/seed'
import { resetAll } from '../lib/store'
import Shell from './Shell'

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../lib/tiktokData', () => ({ useDropDemoTikTokBaseline: () => undefined }))

afterEach(cleanup)

it('reports mobile navigation state and closes it with Escape', () => {
  resetAll(createSampleSeed())
  render(<Shell>Dashboard</Shell>)
  const menu = screen.getByRole('button', { name: 'Open menu' })
  expect(menu.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(menu)
  expect(menu.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(menu.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(menu)
})

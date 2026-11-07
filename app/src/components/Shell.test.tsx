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

it('offers a skip link to the main content before the navigation', () => {
  resetAll(createSampleSeed())
  render(<Shell>Dashboard</Shell>)
  const skip = screen.getByRole('link', { name: 'Skip to content' })
  expect(skip.getAttribute('href')).toBe('#main-content')
  expect(document.getElementById('main-content')?.tagName).toBe('MAIN')
  expect(skip.compareDocumentPosition(screen.getByRole('link', { name: /Overview/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publishBlock } from '../lib/rules'
import { createSampleSeed, SAMPLE_PROFILE } from '../lib/seed'
import { getState, resetAll } from '../lib/store'

const PUBLISH_BLOCK = publishBlock(SAMPLE_PROFILE.creatorName)
const APPROVE = `Approve (${SAMPLE_PROFILE.creatorName})`
import ContentStudio from './ContentStudio'

const c001 = () => getState().content.find((c) => c.id === 'C-001')!

function openC001() {
  render(<ContentStudio />)
  fireEvent.click(screen.getByTitle(/^C-001 ·/))
  return screen.getByRole('dialog')
}

const logButton = (d: HTMLElement) => within(d).getByRole('button', { name: 'Log as published' })
const urlInput = (d: HTMLElement) => within(d).getByLabelText('Live post URL')
const alertText = (d: HTMLElement) => within(d).queryByRole('alert')?.textContent ?? null

describe('Content Studio: blocked "Log as published" shows a visible message', () => {
  beforeEach(() => resetAll(createSampleSeed()))
  afterEach(() => cleanup())

  it('names both missing items, keeps status, and saves nothing', async () => {
    const d = openC001()
    expect(alertText(d)).toBeNull()
    fireEvent.click(logButton(d))
    expect(alertText(d)).toBe(PUBLISH_BLOCK.both)
    expect(c001()).toMatchObject({ status: 'draft', approval: 'pending', url: '', publishedAt: '' })
    // Persistent: no timeout clears it.
    await new Promise((r) => setTimeout(r, 2000))
    expect(alertText(d)).toBe(PUBLISH_BLOCK.both)
  }, 5000)

  it('approved but no URL names only the URL', () => {
    const d = openC001()
    fireEvent.click(within(d).getByRole('button', { name: APPROVE }))
    fireEvent.click(logButton(d))
    expect(alertText(d)).toBe(PUBLISH_BLOCK.url)
    fireEvent.change(urlInput(d), { target: { value: 'tiktok.com/no-scheme' } })
    fireEvent.click(logButton(d))
    expect(alertText(d)).toBe(PUBLISH_BLOCK.url)
    expect(c001()).toMatchObject({ status: 'approved', url: '' })
  })

  it('URL present but not approved names only approval, and the URL is not saved', () => {
    const d = openC001()
    fireEvent.change(urlInput(d), { target: { value: 'https://www.tiktok.com/@creator/video/1' } })
    fireEvent.click(logButton(d))
    expect(alertText(d)).toBe(PUBLISH_BLOCK.approval)
    expect(c001()).toMatchObject({ status: 'draft', approval: 'pending', url: '' })
  })

  it('clears once fixed, then logs as published as before', () => {
    const d = openC001()
    fireEvent.click(logButton(d))
    expect(alertText(d)).toBe(PUBLISH_BLOCK.both)
    fireEvent.click(within(d).getByRole('button', { name: APPROVE }))
    expect(alertText(d)).toBe(PUBLISH_BLOCK.url)
    const url = 'https://www.tiktok.com/@creator/video/1'
    fireEvent.change(urlInput(d), { target: { value: url } })
    expect(alertText(d)).toBeNull()
    fireEvent.click(logButton(d))
    expect(c001()).toMatchObject({ status: 'published', approval: 'approved', url })
    expect(within(d).queryByRole('button', { name: 'Log as published' })).toBeNull()
  })
})

it('identifies Threads items and exposes the selected calendar view', () => {
  const s = createSampleSeed()
  const item = { ...s.content[0], platform: 'threads' as const, title: 'Threads brief' }
  resetAll({ ...s, content: [item] })
  render(<ContentStudio />)
  expect(screen.getByRole('button', { name: 'calendar' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByTitle(new RegExp(`^${item.id} ·`)).textContent).toContain('Threads')
  fireEvent.click(screen.getByRole('button', { name: 'list' }))
  expect(screen.getByRole('button', { name: 'list' }).getAttribute('aria-pressed')).toBe('true')
  cleanup()
})

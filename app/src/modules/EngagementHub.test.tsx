// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSampleSeed } from '../lib/seed'
import { getState, resetAll } from '../lib/store'
import EngagementHub from './EngagementHub'

const URL_ = 'https://www.tiktok.com/@someone/video/123'

beforeEach(() => {
  const s = createSampleSeed()
  resetAll({
    ...s,
    engagements: [
      { id: 'E-9', platform: 'tiktok', account: '@me', sourcePost: URL_, author: 'fan', comment: 'How?', keyword: '', category: 'question', draftReply: 'Here is how.', status: 'approved', leadId: '', note: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'E-10', platform: 'x', sourcePost: 'https://x.com/a/status/1', author: 'b', comment: 'Hi', keyword: '', category: 'question', draftReply: 'Hello there.', status: 'approved', leadId: '', note: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ],
  })
})
afterEach(() => {
  cleanup()
})

describe('engagement links and sending through the creative agent', () => {
  it('exposes the selected queue filter', () => {
    render(<EngagementHub />)
    expect(screen.getByRole('button', { name: /Needs action/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Approved to post/ }))
    expect(screen.getByRole('button', { name: /Approved to post/ }).getAttribute('aria-pressed')).toBe('true')
  })
  it('links each item to its post and opens it in a new tab', () => {
    render(<EngagementHub />)
    fireEvent.click(screen.getByRole('button', { name: /Approved to post/ }))
    const links = screen.getAllByRole('link', { name: /Open (on (TikTok|X)|to reply)/ })
    expect(links.map((a) => a.getAttribute('href')).sort()).toEqual([URL_, URL_, 'https://x.com/a/status/1', 'https://x.com/a/status/1'].sort())
    expect(screen.getByRole('link', { name: /Open on TikTok/ }).getAttribute('href')).toBe(URL_)
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
    }
  })

  it('asks the creative agent to send the exact approved text once, only on its platforms', () => {
    render(<EngagementHub />)
    fireEvent.click(screen.getByRole('button', { name: /Approved to post/ }))
    const creative = getState().profile.agents.creative.name
    const send = screen.getAllByRole('button', { name: `Send via ${creative}` })
    expect(send).toHaveLength(1)
    const previousCount = getState().handoffs.length
    fireEvent.click(send[0])
    expect(getState().handoffs).toHaveLength(previousCount)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    const h = getState().handoffs.at(-1)!
    expect(h).toMatchObject({ from: 'creator', to: 'creative', type: 'question', refs: [{ collection: 'engagement_queue', id: 'E-9' }] })
    expect(h.itemId).toMatch(/^AUDIT-\d{4}-\d{2}-\d{2}$/)
    expect(h.message).toContain('Here is how.')
    expect(screen.getByRole('button', { name: `Asked ${creative} to send` })).toHaveProperty('disabled', true)
  })

  it('lets you type post links one per line and saves them when you leave the box', () => {
    const st = getState()
    resetAll({ ...st, keywords: [{ id: 'K-1', keyword: 'AGENT', approvedResource: '', deliveryMethod: 'TikTok DM', cta: '', replyTemplate: '', active: false, resourceId: '', postUrls: [] }] })
    render(<EngagementHub />)
    const box = screen.getByLabelText('Only on these posts') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'https://www.tiktok.com/@a/video/1\nhttps://www.tik' } })
    expect(box.value).toBe('https://www.tiktok.com/@a/video/1\nhttps://www.tik')
    fireEvent.change(box, { target: { value: 'https://www.tiktok.com/@a/video/1\nhttps://www.tiktok.com/@a/video/2\nnot-a-link' } })
    expect(screen.getByText(/will be skipped: not-a-link/)).toBeTruthy()
    fireEvent.blur(box)
    expect(getState().keywords[0].postUrls).toEqual(['https://www.tiktok.com/@a/video/1', 'https://www.tiktok.com/@a/video/2'])
    expect(screen.getByLabelText(/Exact CTA/).tagName).toBe('TEXTAREA')
  })

  it('offers Send again once the approved text differs from what was already requested', () => {
    render(<EngagementHub />)
    fireEvent.click(screen.getByRole('button', { name: /Approved to post/ }))
    const creative = getState().profile.agents.creative.name
    fireEvent.click(screen.getByRole('button', { name: `Send via ${creative}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('button', { name: `Asked ${creative} to send` })).toHaveProperty('disabled', true)
    cleanup()
    const st = getState()
    resetAll({ ...st, engagements: st.engagements.map((x) => (x.id === 'E-9' ? { ...x, draftReply: 'A better, new reply.' } : x)) })
    render(<EngagementHub />)
    fireEvent.click(screen.getByRole('button', { name: /Approved to post/ }))
    expect(screen.getByRole('button', { name: `Send via ${creative}` })).toHaveProperty('disabled', false)
  })

  it('Manually replied marks an open item done and keeps a note, without approving it first', () => {
    const st = getState()
    resetAll({ ...st, engagements: [{ id: 'E-20', platform: 'tiktok', sourcePost: URL_, author: 'fan', comment: 'Love it', keyword: '', category: 'appreciation', draftReply: '', status: 'new', leadId: '', note: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] })
    render(<EngagementHub />)
    fireEvent.click(screen.getByRole('button', { name: 'Manually replied' }))
    const e = getState().engagements[0]
    expect(e.status).toBe('posted_by_day')
    expect(e.note).toMatch(/^Manually replied by /)
  })
})

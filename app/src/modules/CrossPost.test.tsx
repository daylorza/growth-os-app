// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toLocalInput } from '../lib/dates'
import { createSampleSeed, SAMPLE_PROFILE } from '../lib/seed'
import { getState, patch, resetAll } from '../lib/store'
import ContentStudio from './ContentStudio'

const who = SAMPLE_PROFILE.creatorName
const c001 = () => getState().content.find((c) => c.id === 'C-001')!
const inTwoHours = () => toLocalInput(new Date(Date.now() + 7_200_000).toISOString())

function openC001() {
  render(<ContentStudio />)
  fireEvent.click(screen.getByTitle(/^C-001 ·/))
  return screen.getByRole('dialog')
}
const row = (d: HTMLElement, platform: string) => within(d).getByTestId(`target-${platform}`)
const approveFor = (r: HTMLElement) => within(r).getByRole('button', { name: `Approve for Buffer (${who})` })

describe('Content Studio: publishing through Buffer', () => {
  beforeEach(() => resetAll(createSampleSeed()))
  afterEach(() => cleanup())

  it('adds a platform version as a draft, with the brief caption to start from', () => {
    const d = openC001()
    fireEvent.click(within(d).getByRole('button', { name: 'Add a Threads version' }))
    const t = c001().targets!
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ platform: 'threads', status: 'draft', caption: c001().caption, bufferPostId: '' })
    expect(within(row(d, 'threads')).getByText('Draft')).toBeTruthy()
  })

  it('a blocked approval says why and changes nothing', () => {
    const d = openC001()
    fireEvent.click(within(d).getByRole('button', { name: 'Add a TikTok version' }))
    fireEvent.click(approveFor(row(d, 'tiktok')))
    expect(within(row(d, 'tiktok')).getByText(`${who} must approve this item before its TikTok version.`)).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: `Approve (${who})` }))
    fireEvent.change(within(d).getByLabelText('TikTok publish time'), { target: { value: inTwoHours() } })
    fireEvent.click(approveFor(row(d, 'tiktok')))
    expect(within(row(d, 'tiktok')).getByText('TikTok needs a video. Add the public media link first.')).toBeTruthy()
    expect(c001().targets![0].status).toBe('draft')
  })

  it('approves one version after a confirm, locks it, lists it in the queue, and can unapprove it', () => {
    const d = openC001()
    fireEvent.click(within(d).getByRole('button', { name: `Approve (${who})` }))
    fireEvent.click(within(d).getByRole('button', { name: 'Add a X version' }))
    const x = row(d, 'x')
    fireEvent.change(within(x).getByLabelText('X caption'), { target: { value: 'Native X take' } })
    fireEvent.change(within(x).getByLabelText('X publish time'), { target: { value: inTwoHours() } })
    fireEvent.click(approveFor(x))
    fireEvent.click(within(x).getByRole('button', { name: 'Confirm' }))
    expect(c001().targets![0]).toMatchObject({ platform: 'x', status: 'approved', caption: 'Native X take' })
    expect((within(x).getByLabelText('X caption') as HTMLTextAreaElement).readOnly).toBe(true)
    const queue = screen.getByRole('heading', { name: 'Publishing through Buffer' }).closest('section')!
    expect(within(queue).getByText('Approved, sending to Buffer')).toBeTruthy()
    fireEvent.click(within(x).getByRole('button', { name: 'Unapprove' }))
    expect(c001().targets![0].status).toBe('draft')
  })

  it('a live version shows only the metrics Buffer reported, with when Buffer measured them', () => {
    const sent = { platform: 'x' as const, caption: 'X take', scheduledAt: '2026-11-08T12:00:00.000Z', status: 'sent' as const, bufferPostId: 'b', liveUrl: 'https://x.com/a/status/1', error: '' }
    const values = [{ type: 'views', name: 'Views', value: 1200, unit: 'count' as const }, { type: 'engagementRate', name: 'Engagement Rate', value: 4.5, unit: 'percentage' as const }]
    patch('content', 'C-001', { targets: [{ ...sent, metrics: { source: 'buffer', measuredAt: '2026-11-10T03:00:00.000Z', readAt: '2026-11-10T12:00:00.000Z', values } }, { ...sent, platform: 'threads', liveUrl: 'https://www.threads.com/@me/post/1', metrics: { source: 'buffer', measuredAt: '', readAt: '2026-11-10T12:00:00.000Z', values: [] } }] })
    const d = openC001()
    const x = row(d, 'x')
    expect(within(x).getByText('Views').nextSibling?.textContent).toBe('1,200')
    expect(within(x).getByText('Engagement Rate').nextSibling?.textContent).toBe('4.5%')
    expect(within(x).queryByText('Reach')).toBeNull()
    expect(within(x).getByText(/^From Buffer, measured/)).toBeTruthy()
    expect(within(row(d, 'threads')).getByText(/Buffer has no metrics for this post yet/)).toBeTruthy()
  })

  it('keeps an invalid media link out of the item', () => {
    const d = openC001()
    const media = within(d).getByLabelText('Media link')
    fireEvent.change(media, { target: { value: 'http://example.com/clip.mp4' } })
    fireEvent.blur(media)
    expect(within(d).getByText('Use a public https link.')).toBeTruthy()
    expect(c001().mediaUrl).toBeUndefined()
    fireEvent.change(media, { target: { value: 'https://media.example.com/clip.mp4' } })
    fireEvent.blur(media)
    expect(c001().mediaUrl).toBe('https://media.example.com/clip.mp4')
  })
})

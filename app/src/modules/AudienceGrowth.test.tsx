// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSampleSeed } from '../lib/seed'
import { resetAll } from '../lib/store'
import AudienceGrowth from './AudienceGrowth'

vi.mock('../lib/tiktokData', () => ({
  useTikTok: () => ({}),
  useFollowerSnapshots: () => [
    { id: 'old', platform: 'tiktok', date: '2026-10-01', count: 10, source: 'manual', verified: true },
    { id: 'first', platform: 'tiktok', date: '2026-11-02', count: 20, source: 'manual', verified: true },
    { id: 'last', platform: 'tiktok', date: '2026-11-06', count: 25, source: 'manual', verified: true },
  ],
}))
vi.mock('./TikTokStudio', () => ({ default: () => null }))

afterEach(() => { cleanup(); vi.useRealTimers() })

it('shows the selected period and its follower snapshots in the trend', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 7, 12))
  const seed = createSampleSeed()
  resetAll({ ...seed, settings: { ...seed.settings, campaignStart: '2026-10-01' } })
  render(<AudienceGrowth />)
  expect(screen.getByText('Nov 2–Nov 6 · 2 snapshots')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: 'campaign' } })
  expect(screen.queryByText('Nov 2–Nov 6 · 2 snapshots')).toBeNull()
})

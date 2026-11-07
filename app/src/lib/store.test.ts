// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createSampleSeed } from './seed'
import { clearDemoData, demoRecords, getState, resetAll } from './store'
import type { AppState } from './types'

const withDemo = (): AppState => {
  const s = createSampleSeed()
  const [a, b] = s.content
  return {
    ...s,
    content: [{ ...a, demo: true }, { ...b, demo: true }, ...s.content.slice(2).map((c) => ({ ...c, demo: false }))],
    handoffs: [
      { id: 'H-1', from: 'analyst', to: 'creative', itemId: a.id, message: 'Real work on it', createdAt: '2026-01-01', acknowledged: false },
      { id: 'H-2', from: 'creator', to: 'analyst', itemId: b.id, message: 'Example', createdAt: '2026-01-01', acknowledged: false, demo: true },
    ],
  }
}

describe('clear demo data', () => {
  it('lists only example records nothing real points at, never handoffs', () => {
    const s = withDemo()
    const ids = demoRecords(s).map((r) => r.id)
    expect(ids).toContain(s.content[1].id)
    expect(ids).not.toContain(s.content[0].id)
    expect(demoRecords(s).some((r) => r.collection === 'handoffs')).toBe(false)
  })

  it('removes exactly the listed records', () => {
    resetAll(withDemo())
    const before = getState()
    const listed = demoRecords(before).map((r) => r.id)
    clearDemoData()
    const after = getState()
    expect(after.content.map((c) => c.id)).toContain(before.content[0].id)
    expect(after.content.map((c) => c.id)).not.toContain(before.content[1].id)
    expect(after.handoffs).toHaveLength(2)
    expect(demoRecords(after)).toEqual([])
    expect(listed.length).toBeGreaterThan(0)
  })
})

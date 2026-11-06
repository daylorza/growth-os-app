import { describe, expect, it } from 'vitest'
import { parseAnalystReply } from '../src/worker/analyst-reply'

describe('analyst reply parsing (paste-in and live)', () => {
  it('keeps plain pasted text as the whole report', () => {
    expect(parseAnalystReply('Weekly notes.\nNothing structured.')).toEqual({ report: 'Weekly notes.\nNothing structured.', xSnapshot: null, engagementQueue: [] })
  })

  it('reads the trailing json block and drops anything not observed', () => {
    const text = `Intro\n\`\`\`json\n${JSON.stringify({
      report: 'Audit',
      xSnapshot: { date: '2026-01-05', followers: 10, following: 'about 20', posts: null },
      engagementQueue: [{ comment: 'How?', category: 'question', draftReply: 'Thanks' }, { comment: '' }, { comment: 'x', category: 'made-up' }],
    })}\n\`\`\``
    const a = parseAnalystReply(text)
    expect(a.report).toBe('Audit')
    expect(a.xSnapshot).toEqual({ date: '2026-01-05', followers: 10, following: undefined, posts: undefined })
    expect(a.engagementQueue).toHaveLength(2)
    expect(a.engagementQueue[1].category).toBeUndefined()
  })

  it('ignores a snapshot with no observed numbers or a bad date', () => {
    expect(parseAnalystReply('```json\n{"xSnapshot":{"date":"2026-01-05"}}\n```').xSnapshot).toBeNull()
    expect(parseAnalystReply('```json\n{"xSnapshot":{"date":"Jan 5","followers":3}}\n```').xSnapshot).toBeNull()
  })

  it('survives malformed json', () => {
    expect(parseAnalystReply('Report\n```json\n{oops\n```').report).toContain('Report')
  })
})

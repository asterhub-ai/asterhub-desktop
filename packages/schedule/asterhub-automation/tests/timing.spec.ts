/** Calendar, missed-occurrence and pause semantics visible to native task consumers. */
import { describe, expect, it } from 'vitest'
import { normalizeTiming, previewTiming, resolveOccurrence, nextOccurrence, reanchorTiming, TimingInputError } from '../src/timing.ts'

const now = Date.parse('2026-10-05T00:00:00Z')

describe('native task timing', () => {
  it('keeps calendar days distinct from fixed interval phases', () => {
    const wall = normalizeTiming({ kind: 'daily', time: '08:00:00', timeZone: 'Asia/Shanghai' }, now)
    const interval = normalizeTiming({ kind: 'interval', seconds: 7200, firstAt: '2026-10-05T02:00:00Z' }, now)
    expect(previewTiming(wall, now, 3)).toEqual(['2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z', '2026-10-08T00:00:00.000Z'])
    expect(previewTiming(interval, now, 3)).toEqual(['2026-10-05T02:00:00.000Z', '2026-10-05T04:00:00.000Z', '2026-10-05T06:00:00.000Z'])
  })

  it('consumes only the latest missed interval without rephasing', () => {
    const timing = normalizeTiming({ kind: 'interval', seconds: 3600, firstAt: '2026-10-05T01:00:00Z' }, now)
    expect(resolveOccurrence(timing, '2026-10-05T01:00:00Z', Date.parse('2026-10-05T05:30:00Z'))).toEqual({ occurrenceAt: '2026-10-05T05:00:00.000Z', nextAt: '2026-10-05T06:00:00.000Z' })
  })

  it('restarts an interval from resume instead of catching up paused occurrences', () => {
    const timing = normalizeTiming({ kind: 'interval', seconds: 3600, firstAt: '2026-10-05T02:00:00Z' }, now)
    const resume = Date.parse('2026-10-10T00:15:00Z')
    expect(previewTiming(reanchorTiming(timing, resume), resume, 3)).toEqual(['2026-10-10T01:15:00.000Z', '2026-10-10T02:15:00.000Z', '2026-10-10T03:15:00.000Z'])
  })

  it('skips a missing DST clock time rather than delaying it into the same day', () => {
    const start = Date.parse('2026-03-07T00:00:00Z')
    const timing = normalizeTiming({ kind: 'daily', time: '02:30:00', timeZone: 'America/New_York' }, start)
    expect(previewTiming(timing, start, 3)).toEqual(['2026-03-07T07:30:00.000Z', '2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z'])
  })

  it('uses only the earlier instant in a DST overlap', () => {
    const start = Date.parse('2026-10-31T00:00:00Z')
    const timing = normalizeTiming({ kind: 'daily', time: '01:30:00', timeZone: 'America/New_York' }, start)
    expect(previewTiming(timing, start, 3)).toEqual(['2026-10-31T05:30:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'])
  })

  it('keeps selected weekdays and Cron on their calendar rules', () => {
    const weekly = normalizeTiming({ kind: 'weekly', time: '09:00:00', timeZone: 'UTC', weekdays: [5, 1, 3] }, now)
    const cron = normalizeTiming({ kind: 'cron', expression: '0 9 * * 1,3,5', timeZone: 'UTC' }, now)
    const expected = ['2026-10-05T09:00:00.000Z', '2026-10-07T09:00:00.000Z', '2026-10-09T09:00:00.000Z']
    expect(previewTiming(weekly, now, 3)).toEqual(expected)
    expect(previewTiming(cron, now, 3)).toEqual(expected)
  })

  it('preserves an overdue one-shot occurrence but does not offer it on resume', () => {
    const timing = normalizeTiming({ kind: 'once', at: '2026-10-05T08:00:00+08:00' }, now - 1000)
    const later = Date.parse('2026-10-05T01:00:00Z')
    expect(resolveOccurrence(timing, '2026-10-05T00:00:00.000Z', later)).toEqual({ occurrenceAt: '2026-10-05T00:00:00.000Z', nextAt: null })
    expect(nextOccurrence(timing, later)).toBeNull()
  })

  it('anchors delays to acceptance and resolves them only once', () => {
    const timing = normalizeTiming({ kind: 'delay', seconds: 3600 }, now)
    expect(previewTiming(timing, now, 3)).toEqual(['2026-10-05T01:00:00.000Z'])
    expect(resolveOccurrence(timing, '2026-10-05T01:00:00.000Z', now + 7200_000)).toEqual({ occurrenceAt: '2026-10-05T01:00:00.000Z', nextAt: null })
  })

  it('rejects ambiguous instants, past first execution and excessive interval frequency', () => {
    expect(() => normalizeTiming({ kind: 'once', at: '2026-10-06T08:00:00' }, now)).toThrow(TimingInputError)
    expect(() => normalizeTiming({ kind: 'interval', seconds: 60, firstAt: '2026-10-04T08:00:00Z' }, now)).toThrow(TimingInputError)
    expect(() => normalizeTiming({ kind: 'interval', seconds: 59 }, now)).toThrow(TimingInputError)
  })
})

import { describe, expect, it } from 'vitest'
import type { SessionFormatEvent, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { sessionFormatV4ToV5 } from '../src/migration.ts'

const header: SessionFormatHeader = {
  version: 4, id: 'session-one', createdAt: 1, isSeeded: false, delegationDepth: 0,
}

function collector() {
  const events: SessionFormatEvent[] = []
  const runs: number[] = []
  return {
    events, runs,
    context: {
      emitEvent(event: SessionFormatEvent) { events.push(event) },
      emitRun(run: { eventCount: number }) { runs.push(run.eventCount) },
    },
  }
}

describe('Session V4-to-V5 migration', () => {
  it('preserves each original event and seeded cut while updating only the header version', () => {
    const seedHeader = { ...header, isSeeded: true }
    const target = sessionFormatV4ToV5.migrateHeader(seedHeader)
    const migration = sessionFormatV4ToV5.createStage({
      sourceHeader: seedHeader, targetHeader: target, sourceInheritedEventCount: undefined, sourceKind: 'decoded',
    })
    const event = {
      type: 'session/end-seed', seq: 0, time: 1, data: { inherited: true },
    } as const satisfies SessionFormatEvent
    const captured = collector()
    migration.transformEvent(event, captured.context)
    expect(migration.finish(captured.context)).toBe(0)
    expect(captured.events).toEqual([event])
    expect(target).toEqual({ ...seedHeader, version: 5 })
  })

  it('preserves compact runs without expanding their payload', () => {
    const migration = sessionFormatV4ToV5.createStage({
      sourceHeader: header, targetHeader: sessionFormatV4ToV5.migrateHeader(header),
      sourceInheritedEventCount: 0, sourceKind: 'decoded',
    })
    const run = { runType: 'assistant-stream', firstSeq: 0, eventCount: 42, expand: () => { throw new Error('must preserve the run') } }
    const captured = collector()
    migration.transformRun(run, captured.context)
    expect(migration.finish(captured.context)).toBe(0)
    expect(captured.runs).toEqual([42])
  })

  it('rejects a mismatched source header', () => {
    expect(() => { assertReleasedV4Header({ ...header, version: 3 }) }).toThrow('expected format v4 header')
  })
})

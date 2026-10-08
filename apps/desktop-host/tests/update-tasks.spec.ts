/** Regression tests for the Desktop update admission and native automation lock. */

import { Context } from '@deepseek-ai/cordis'
import { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { JobStatus, JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installDesktopUpdateTaskControl } from '../src/update-tasks.ts'

type AgentState = { id: SessionId; status: 'idle' | 'running'; inbox: { nextTurn: object[]; nextStep: object[] } }

let ctx: Context
let control: ReturnType<typeof installDesktopUpdateTaskControl>
const agents: AgentState[] = []
const jobs = new Map<SessionId | undefined, JobStatus[]>()
/** Records every `setAdmissionLocked` call so tests assert the lock toggles. */
const admissionCalls: boolean[] = []

class RosterOnlyJobRegistry extends JobRegistry {
  readonly events = { subscribe: () => () => {} }
  start(): never { throw new Error('unsupported') }
  list(caller?: SessionId): JobView[] {
    return (jobs.get(caller) ?? []).map((status, index) => ({
      id: JobId(`bash-${index + 1}`),
      kind: 'bash',
      label: 'sleep 60',
      ...caller === undefined ? {} : { owner: caller },
      status,
      startedAt: 0,
      output: { total: 0, earliest: 0 },
    }))
  }
  get(): never { throw new Error('unsupported') }
  read(): never { throw new Error('unsupported') }
  readAt(): never { throw new Error('unsupported') }
  kill(): never { throw new Error('unsupported') }
  wait(): never { throw new Error('unsupported') }
  remove(): never { throw new Error('unsupported') }
  attachController(): () => void { return () => {} }
}

function agent(id: string, status: 'idle' | 'running' = 'idle'): AgentState {
  return { id: SessionId(id), status, inbox: { nextTurn: [], nextStep: [] } }
}

beforeEach(() => {
  agents.length = 0
  jobs.clear()
  admissionCalls.length = 0
  ctx = new Context()
  ctx.provide('agents', { list: () => agents } as never)
  new RosterOnlyJobRegistry(ctx)
  control = installDesktopUpdateTaskControl(ctx)
})

afterEach(async () => { await ctx.fiber.dispose() })

describe('Desktop Host update task control', () => {
  it('reports no active work for idle sessions', async () => {
    agents.push(agent('quiet'))
    expect(await control('inspect')).toBe(false)
  })

  it('reports active work for a running agent', async () => {
    agents.push(agent('busy', 'running'))
    expect(await control('inspect')).toBe(true)
  })

  it('does not toggle native admission lock on inspect', async () => {
    ctx.provide('asterhubAutomation', {
      setAdmissionLocked: (locked: boolean) => { admissionCalls.push(locked) },
    } as never)
    await control('inspect')
    expect(admissionCalls).toEqual([])
  })

  it('locks native admission on lock and unlocks on unlock', async () => {
    ctx.provide('asterhubAutomation', {
      setAdmissionLocked: (locked: boolean) => { admissionCalls.push(locked) },
    } as never)
    await control('lock')
    expect(admissionCalls).toEqual([true])
    await control('unlock')
    expect(admissionCalls).toEqual([true, false])
  })

  it('ignores native admission control when the service is absent', async () => {
    // No automation service provided; lock/unlock must not throw.
    await control('lock')
    await control('unlock')
    expect(admissionCalls).toEqual([])
  })

  it('refuses control after disposal', async () => {
    await ctx.fiber.dispose()
    await expect(control('inspect')).rejects.toThrow('Host is stopping')
  })
})

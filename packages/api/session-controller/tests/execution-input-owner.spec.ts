/** Regression tests for SessionController execution input owner contract.
 * - close-vs-prompt: terminal scheduler close cannot overlap with incoming manual prompts
 * - the work callback is serialized in the same FIFO as closeIf
 * - pending prompts after closure wait for release and then resolve normal Agent
 * - duplicate owner registration rejects
 */

import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createSessionTestController, installSessionReadTestServices } from './test-remote.ts'

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

async function makeHarness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => undefined,
  })
  const controller = createSessionTestController(ctx, defaults)
  return { ctx, controller }
}

describe('SessionExecutionInputOwner', () => {
  it('closeIf returns true when predicate passes and blocks new work', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-1')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // closeIf should return true when predicate passes
    const result = await owner.closeIf(() => true)
    expect(result).toBe(true)

    // After close, new work should wait (admit should not resolve immediately)
    const signal = new AbortController()
    let admitted = false
    owner.admit(async () => { admitted = true }, signal.signal).catch(() => {})
    // Yield to let microtasks settle without fixed sleep
    await Promise.resolve()
    await Promise.resolve()
    expect(admitted).toBe(false)

    signal.abort()
  })

  it('closeIf returns false when predicate fails', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-2')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // closeIf should return false when predicate fails
    const result = await owner.closeIf(() => false)
    expect(result).toBe(false)

    // After failed close, work should still be admitted normally
    const value = await owner.admit(async () => 'ok', new AbortController().signal)
    expect(value).toBe('ok')
  })

  it('closeIf serializes behind already-admitted work', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-3')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // Start an admit whose work blocks until we resolve it
    const workGate = Promise.withResolvers<void>()
    let workStarted = false
    let workFinished = false
    const slowAdmit = owner.admit(async () => {
      workStarted = true
      await workGate.promise
      workFinished = true
      return 'slow'
    }, new AbortController().signal)

    // Start closeIf while admit work is pending
    let predicateCalled = false
    const closeIfPromise = owner.closeIf(() => {
      predicateCalled = true
      return true
    })

    // Yield to let the admit's work start
    await Promise.resolve()
    await Promise.resolve()
    expect(workStarted).toBe(true)
    expect(predicateCalled).toBe(false) // Predicate not called yet

    // Resolve the work
    workGate.resolve()
    await slowAdmit

    // Now closeIf should proceed
    const result = await closeIfPromise
    expect(result).toBe(true)
    expect(workFinished).toBe(true)
  })

  it('pending work after closure waits for release then resolves', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-4')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // Close the owner
    await owner.closeIf(() => true)

    // Start new work that should wait
    const signal = new AbortController()
    let admitted = false
    const admitPromise = owner.admit(async () => { admitted = true; return 'after' }, signal.signal)

    // Should not resolve immediately - yield microtasks
    await Promise.resolve()
    await Promise.resolve()
    expect(admitted).toBe(false)

    // Release should allow the work to resolve
    owner.release()
    const value = await admitPromise
    expect(admitted).toBe(true)
    expect(value).toBe('after')
  })

  it('release removes owner from registry', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-5')
    const owner = controller.registerExecutionInputOwner(sessionId)

    // Release should remove the owner
    owner.release()

    // Getting a new owner should return a fresh one (not the same reference)
    const newOwner = controller.registerExecutionInputOwner(sessionId)
    expect(newOwner).not.toBe(owner)
    newOwner.release()
  })

  it('admit rejects when signal is already aborted', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-6')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    const signal = new AbortController()
    signal.abort()

    await expect(owner.admit(async () => 'x', signal.signal)).rejects.toBeDefined()
  })

  it('closeIf synchronous predicate works correctly', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-7')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    const result = await owner.closeIf(() => true)
    expect(result).toBe(true)
  })

  it('idempotent closeIf after release', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-8')
    const owner = controller.registerExecutionInputOwner(sessionId)

    // Release immediately
    owner.release()

    // closeIf should return false after release
    const result = await owner.closeIf(() => true)
    expect(result).toBe(false)
  })

  it('duplicate owner registration rejects', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-9')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // Second registration for the same session should throw
    expect(() => controller.registerExecutionInputOwner(sessionId)).toThrow()
  })

  it('admit returns work result when not closed', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-10')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    const value = await owner.admit(async () => 42, new AbortController().signal)
    expect(value).toBe(42)
  })

  it('admit serializes multiple work units in FIFO order', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-11')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    const order: string[] = []
    const a = owner.admit(async () => { order.push('a'); return 'a' }, new AbortController().signal)
    const b = owner.admit(async () => { order.push('b'); return 'b' }, new AbortController().signal)
    const c = owner.admit(async () => { order.push('c'); return 'c' }, new AbortController().signal)

    const [ra, rb, rc] = await Promise.all([a, b, c])
    expect(order).toEqual(['a', 'b', 'c'])
    expect([ra, rb, rc]).toEqual(['a', 'b', 'c'])
  })

  it('closeIf predicate runs after in-flight work, before queued work', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-12')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // First work unit blocks
    const firstGate = Promise.withResolvers<void>()
    const first = owner.admit(async () => { await firstGate.promise; return 'first' }, new AbortController().signal)

    // closeIf should run after first work, before second work
    let predicateRan = false
    const closeIf = owner.closeIf(() => { predicateRan = true; return true })

    // Second work unit should be blocked behind closeIf
    let secondRan = false
    const second = owner.admit(async () => { secondRan = true; return 'second' }, new AbortController().signal)

    // Yield microtasks
    await Promise.resolve()
    await Promise.resolve()
    expect(predicateRan).toBe(false)
    expect(secondRan).toBe(false)

    firstGate.resolve()
    await first

    // closeIf predicate should run now, before second work
    await closeIf
    expect(predicateRan).toBe(true)

    // After close, second work waits for release
    await Promise.resolve()
    await Promise.resolve()
    expect(secondRan).toBe(false)

    owner.release()
    const secondValue = await second
    expect(secondRan).toBe(true)
    expect(secondValue).toBe('second')
  })

  it('admit waits for ready promise before submitting work', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-13')
    const ready = Promise.withResolvers<void>()
    const owner = controller.registerExecutionInputOwner(sessionId, ready.promise)
    onTestFinished(() => { owner.release() })

    // Start admit - should not complete until ready resolves
    let workStarted = false
    const admit = owner.admit(async () => { workStarted = true; return 'done' }, new AbortController().signal)

    // Yield microtasks - work should not have started
    await Promise.resolve()
    await Promise.resolve()
    expect(workStarted).toBe(false)

    // Resolve ready
    ready.resolve()
    const value = await admit
    expect(value).toBe('done')
    expect(workStarted).toBe(true)
  })

  it('closeIf does NOT wait for ready - runs immediately', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-14')
    const ready = Promise.withResolvers<void>()
    const owner = controller.registerExecutionInputOwner(sessionId, ready.promise)
    onTestFinished(() => { owner.release(); ready.resolve() })

    // closeIf should run immediately without waiting for ready
    const result = await owner.closeIf(() => true)
    expect(result).toBe(true)
  })

  it('release resolves readyGate so admits can proceed even if ready never resolves', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-15')
    const ready = Promise.withResolvers<void>()
    const owner = controller.registerExecutionInputOwner(sessionId, ready.promise)

    // Release before ready resolves
    owner.release()

    // Admit should now work (released returns work() immediately, bypassing ready check)
    const value = await owner.admit(async () => 'after-release', new AbortController().signal)
    expect(value).toBe('after-release')
  })

  it('admit rejects if signal aborts while waiting for ready', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-16')
    const ready = Promise.withResolvers<void>()
    const owner = controller.registerExecutionInputOwner(sessionId, ready.promise)
    onTestFinished(() => { owner.release(); ready.resolve() })

    const signal = new AbortController()
    const admit = owner.admit(async () => 'done', signal.signal)

    // Abort while waiting for ready
    signal.abort()

    await expect(admit).rejects.toBeDefined()
  })

  it('deterministic barrier: work1 blocked, closeIf, work2, release work1 => close true, work2 must not run until release', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-17')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // work1 blocks
    const work1Gate = Promise.withResolvers<void>()
    let work1Ran = false
    const work1 = owner.admit(async () => {
      work1Ran = true
      await work1Gate.promise
      return 'work1'
    }, new AbortController().signal)

    // Yield to let work1 start
    await Promise.resolve()
    await Promise.resolve()
    expect(work1Ran).toBe(true)

    // closeIf called while work1 is in-flight
    let predicateRan = false
    const closeIf = owner.closeIf(() => { predicateRan = true; return true })

    // work2 called after closeIf
    let work2Ran = false
    const work2 = owner.admit(async () => { work2Ran = true; return 'work2' }, new AbortController().signal)

    // Yield microtasks - closeIf should not have run yet (work1 still in-flight)
    await Promise.resolve()
    await Promise.resolve()
    expect(predicateRan).toBe(false)
    expect(work2Ran).toBe(false)

    // Release work1 - closeIf should now run and return true
    work1Gate.resolve()
    await work1
    const closeResult = await closeIf
    expect(closeResult).toBe(true)
    expect(predicateRan).toBe(true)

    // work2 must NOT run yet (owner is closed)
    await Promise.resolve()
    await Promise.resolve()
    expect(work2Ran).toBe(false)

    // Now release the owner - work2 should run
    owner.release()
    const work2Value = await work2
    expect(work2Ran).toBe(true)
    expect(work2Value).toBe('work2')
  })

  it('aborted queued work must not execute after signal abort', async () => {
    const { ctx, controller } = await makeHarness()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sessionId = SessionId('test-session-18')
    const owner = controller.registerExecutionInputOwner(sessionId)
    onTestFinished(() => { owner.release() })

    // First work blocks
    const work1Gate = Promise.withResolvers<void>()
    const work1 = owner.admit(async () => { await work1Gate.promise; return 'work1' }, new AbortController().signal)

    // Second work with abort signal
    const work2Signal = new AbortController()
    let work2Ran = false
    const work2 = owner.admit(async () => { work2Ran = true; return 'work2' }, work2Signal.signal)

    // Yield to let work1 start
    await Promise.resolve()
    await Promise.resolve()

    // Abort work2 while it's queued behind work1
    work2Signal.abort()

    // Release work1
    work1Gate.resolve()
    await work1

    // work2 should reject due to abort, NOT execute
    await expect(work2).rejects.toBeDefined()
    expect(work2Ran).toBe(false)
  })
})

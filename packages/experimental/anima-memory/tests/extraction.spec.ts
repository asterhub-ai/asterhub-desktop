import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, type FinishReason, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Policy } from '../src/config.ts'
import { invokeModel, parseModelOutput, type ModelOperation } from '../src/extraction.ts'

describe('parseModelOutput', () => {
  const stop: FinishReason = { kind: 'stop' }

  it('parses a complete JSON code fence without accepting surrounding prose', () => {
    expect(parseModelOutput('```json\n{"ok":true}\n```', stop)).toEqual({ ok: true })
    expect(() => parseModelOutput('Here is the JSON:\n```json\n{"ok":true}\n```', stop)).toThrow()
    expect(() => parseModelOutput('```json\n{"ok":true}\n```\nDone.', stop)).toThrow()
  })

  it('rejects JSON from a response that did not stop normally', () => {
    expect(() => parseModelOutput('{"partial":true}', { kind: 'max-tokens' })).toThrow(/did not finish successfully/u)
  })
})

/** Bounded policy fixture; only the limits invoked by `invokeModel` matter. */
const policy: Policy = {
  enabled: true, automaticRecall: false, captureEpisodes: false, allowMemoryWrites: false, reflectionEnabled: false,
  recallLimit: 8, maxContextBytes: 1 << 20, maxMemoryChars: 4000, modelProvider: '', model: '',
  maxInputBytes: 1 << 20, maxOutputTokens: 512, timeoutMs: 5000,
}

const stopChunks: readonly StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: '{"ok":true}' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '{"ok":true}' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

/** Live LlmRuntime whose stream waterfall short-circuits to one fixed chunk stream. */
async function streamingContext(chunks: readonly StreamChunk[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.on('llm/stream', () => (async function * () {
    for (const chunk of chunks) yield chunk
  })())
  return ctx
}

function extractionOperation(agent: Agent): ModelOperation {
  return { agent, signal: AbortSignal.timeout(5000), policy, route: { provider: 'fixture', model: 'fixture' } }
}

describe('invokeModel', () => {
  it('logs the request and result as ignorable plugin records with linked sequence numbers', async () => {
    const session = Session.create(SessionId('anima-invoke'))
    const agent = { id: SessionId('anima-agent'), session } as Agent
    const result = await invokeModel(await streamingContext(stopChunks), extractionOperation(agent), 'extraction', 'system prompt', { key: 'value' })
    expect(result).toEqual({ ok: true })

    const events = session.snapshotEvents()
    expect(events.map(event => event.type)).toEqual(['plugin:anima-memory/extraction-request', 'plugin:anima-memory/extraction-result'])
    expect(events.map(event => event.ignorable)).toEqual([true, true])
    const [request, outcome] = events.map(pluginRecordOf)
    expect(request).toMatchObject({
      type: 'plugin:anima-memory/extraction-request', seq: 0,
      data: { route: { provider: 'fixture', model: 'fixture' }, operation: 'extraction', system: 'system prompt', maxTokens: 512 },
    })
    expect(outcome).toMatchObject({
      type: 'plugin:anima-memory/extraction-result', seq: 1, data: { requestSeq: 0, text: '{"ok":true}', error: null },
    })
  })

  it('logs the failure result against the same request before rethrowing', async () => {
    const session = Session.create(SessionId('anima-invoke-failure'))
    const agent = { id: SessionId('anima-agent'), session } as Agent
    const chunks: readonly StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"partial":true}' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]
    await expect(invokeModel(await streamingContext(chunks), extractionOperation(agent), 'review', 'system prompt', { key: 'value' }))
      .rejects.toThrow(/did not finish successfully/u)

    const events = session.snapshotEvents()
    expect(events.map(event => event.type)).toEqual(['plugin:anima-memory/extraction-request', 'plugin:anima-memory/extraction-result'])
    const [, outcome] = events.map(pluginRecordOf)
    expect(outcome).toMatchObject({
      type: 'plugin:anima-memory/extraction-result', seq: 1, data: { requestSeq: 0, text: '{"partial":true}', error: expect.stringContaining('did not finish successfully') },
    })
  })
})

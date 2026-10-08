/** Real tool execution checks for root and nested spill admission. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunSpec, PtcRunResult } from '@deepseek-ai/dsh-ptc-runtime'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SpillLocator, SpillStore, type SaveTextSpill, type SpillRef } from '@deepseek-ai/dsh-spill'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import { formatSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

const spillReference = {
  locator: SpillLocator('/spill/shell.txt'),
  retrievalHint: 'Read the saved text.',
}

class MemorySpillStore extends SpillStore {
  readonly saves: { input: SaveTextSpill; bytes: Buffer }[] = []

  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    const bytes = Buffer.from(input.content, 'utf8')
    this.saves.push({ input, bytes })
    return {
      ...spillReference,
      bytes: bytes.length,
    }
  }
}

const shellArgs = { command: 'fixture-output', description: 'Return shell output fixture' }

async function executeShell(text: string, nested: boolean, name = 'bash', maxInlineTokens = 256) {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'both' })
    await ctx.plugin(MemorySpillStore)
    await ctx.plugin(SpillPolicy, { maxInlineTokens })
    if (nested) {
      // The real registry and spill policy own nested output; evaluator execution has its own process suite.
      class BindingRuntime extends PtcRuntime {
        readonly language = 'typescript'
        readonly isolation = 'fixture'
        resolve(request: PtcRunRequest): PtcRunSpec {
          return { ...request, cwd: process.cwd(), timeoutMs: 120_000 }
        }
        async run(spec: PtcRunSpec): Promise<PtcRunResult> {
          const tool = spec.bindings.find(binding => binding.global === 'tools')?.functions[name]
          if (tool === undefined) throw new Error('missing fixture binding')
          const blocks = await tool(shellArgs)
          expect(blocks).toEqual([{ type: 'text', text }])
          return { logs: [], value: true }
        }
      }
      await ctx.plugin(BindingRuntime)
    }
    ctx.effect(() => ctx.tools.register(defineContentToolFixture({
      name,
      description: 'Return deterministic shell text without spawning a process.',
      parameters: {
        command: { type: 'string', required: true },
        description: { type: 'string', required: true },
      },
      async execute() { return [{ type: 'text', text }] },
    })))
    const session = Session.create(SessionId('spill-terminal'))
    // The tool pipeline reads only the owner session; no agent loop runs here.
    const agent = { session } as Agent
    const callId = ToolCallId('shell-call')
    const result = await ctx.tools.execute({
      callId,
      agent,
      signal: new AbortController().signal,
      name: nested ? 'run_code' : name,
      arguments: nested ? {
        code: `const blocks = await tools.${name}(${JSON.stringify(shellArgs)}); return blocks[0].text === ${JSON.stringify(text)};`,
        description: 'Dispatch shell fixture through the tool pipeline',
      } : shellArgs,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('shell fixture execution failed')

    let content: typeof result.content
    let outputCallId: ToolCallId
    if (nested) {
      expect(result.value).toMatchObject({ result: true })
      const dispatches = session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch')
      expect(dispatches).toHaveLength(1)
      const event = dispatches[0]!
      expect(event.data.isError).toBe(false)
      content = event.data.content
      outputCallId = event.data.subCallId
    } else {
      expect(result.value).toEqual([{ type: 'text', text }])
      content = result.content
      outputCallId = callId
    }
    const saves = (ctx.spillStore as MemorySpillStore).saves
    return { content, callId: outputCallId, saves }
  } finally {
    await ctx.fiber.dispose()
  }
}

describe.each([
  { location: 'root', nested: false },
  { location: 'nested', nested: true },
])('$location spill-policy shell terminal fallback', ({ nested }) => {
  describe.each(['bash', 'pwsh'])('%s', (name) => {
    it.each([
      { outcome: 'nonzero exit', marker: '\n[exit code: 7]' },
      { outcome: 'terminating signal', marker: '\n[killed by signal: SIGTERM]' },
      { outcome: 'markerless output', marker: '' },
    ])('keeps a spilled $outcome result generic', async ({ marker }) => {
      const original = 'HEAD 雪\n'.repeat(200) + marker
      const { content, callId, saves } = await executeShell(original, nested, name)
      expect(saves).toHaveLength(1)
      expect(saves[0]!.input).toMatchObject({
        owner: { sessionId: 'spill-terminal' },
        source: { toolName: name, callId, label: nested ? 'dispatch' : 'result' },
        content: original,
      })
      expect(saves[0]!.bytes).toEqual(Buffer.from(original, 'utf8'))
      expect(content).not.toEqual([{ type: 'text', text: original }])
      expect(content).toHaveLength(1)
      const preview = content[0]!
      if (preview.type !== 'text') throw new Error('expected a plain-text spill preview')
      expect(estimateContent(content)).toBeLessThanOrEqual(256)
      expect(preview.text).toContain('HEAD')
      if (marker !== '') expect(preview.text).toContain(marker)
    })

    it('persists a notice-only result when no preview fits', async () => {
      const original = '雪'.repeat(1_000) + '\n[exit code: 9]'
      const notice = formatSpillNotice({ kind: 'exact', count: Buffer.byteLength(original, 'utf8') }, spillReference)
      const { content, saves } = await executeShell(original, nested, name, estimateContent([{ type: 'text', text: notice }]))
      expect(content).toEqual([{ type: 'text', text: notice }])
      expect(saves).toHaveLength(1)
      expect(saves[0]!.bytes).toEqual(Buffer.from(original, 'utf8'))
    })

    it('retains the exact result when the content fits without spilling', async () => {
      const original = 'short output\n[exit code: 7]'
      const { content, saves } = await executeShell(original, nested, name)
      expect(saves).toHaveLength(0)
      expect(content).toEqual([{ type: 'text', text: original }])
    })
  })
})

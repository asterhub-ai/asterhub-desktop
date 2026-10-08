/** Generic shell presentation for spill previews that hide the final status marker. */
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SpillLocator } from '@deepseek-ai/dsh-spill'
import { formatSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { describe, expect, it } from 'vitest'
import { isSpilledShellCall, terminalCardModel } from '../src/client/tool/models/terminal-card-model.ts'

const shellArgs = { command: 'fixture-output', description: 'Return shell output fixture' }
const spillLocator = SpillLocator('/spill/shell.txt')

function toolResult(content: ToolResultNode['content'], name: string): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 1,
    callTime: null,
    callId: ToolCallId('shell-call'),
    call: { name, argsRaw: JSON.stringify(shellArgs) },
    content,
    isError: false,
    subCalls: [],
  }
}

describe.each(['bash', 'pwsh'])('%s terminal result presentation', (name) => {
  it.each([
    { outcome: 'nonzero exit', marker: '\n[exit code: 7]' },
    { outcome: 'terminating signal', marker: '\n[killed by signal: SIGTERM]' },
    { outcome: 'markerless output', marker: '' },
  ])('keeps spilled $outcome output generic', ({ marker }) => {
    const original = 'HEAD 雪\n'.repeat(200) + marker
    const notice = formatSpillNotice({ kind: 'exact', count: Buffer.byteLength(original, 'utf8') }, {
      locator: spillLocator,
      retrievalHint: 'Read the saved text.',
    })
    const block = toolResult([{ type: 'text', text: `HEAD 雪\n\n${notice}` }], name)

    expect(terminalCardModel(block)).toBeNull()
    expect(isSpilledShellCall(block)).toBe(true)
  })

  it('keeps notice-only spill output generic when no preview fits', () => {
    const original = '雪'.repeat(1_000) + '\n[exit code: 9]'
    const notice = formatSpillNotice({ kind: 'exact', count: Buffer.byteLength(original, 'utf8') }, {
      locator: spillLocator,
      retrievalHint: 'Read the saved text.',
    })
    const block = toolResult([{ type: 'text', text: notice }], name)

    expect(terminalCardModel(block)).toBeNull()
    expect(isSpilledShellCall(block)).toBe(true)
  })

  it('retains a terminal card when complete output fits without spilling', () => {
    const block = toolResult([{ type: 'text', text: 'short output\n[exit code: 7]' }], name)

    expect(terminalCardModel(block)?.card).toMatchObject({ output: 'short output', exitCode: 7 })
    expect(isSpilledShellCall(block)).toBe(false)
  })
})

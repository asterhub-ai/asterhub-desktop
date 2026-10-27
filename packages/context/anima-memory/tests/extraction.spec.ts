import { describe, expect, it } from 'vitest'
import type { FinishReason } from '@deepseek-ai/dsh-llm'
import { parseModelOutput } from '../src/extraction.ts'

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

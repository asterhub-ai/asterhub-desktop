import { describe, expect, it } from 'vitest'
import { PartialArguments } from '../src/index.ts'

describe('streamed tool argument fields', () => {
  it('completes one field while another field is still streaming', () => {
    const args = new PartialArguments()
    args.append('{"file_path":"src/a.ts","content":"prefix')
    expect(args.complete('file_path')).toBe(true)
    expect(args.complete('content')).toBe(false)
    expect(args.text('content')).toBe('prefix')
    args.append(' suffix"}')
    expect(args.complete('content')).toBe(true)
    expect(args.text('content')).toBe('prefix suffix')
  })

  it('does not mistake field names appearing inside values for actual fields', () => {
    const args = PartialArguments.fromText('{"content":"file_path","nested":{"file_path":"not top-level"}}')
    expect(args.has('file_path')).toBe(false)
    expect(args.complete('file_path')).toBe(false)
    expect(args.value('nested')).toEqual({ file_path: 'not top-level' })
  })

  it('decodes Unicode and escaped quotes across fragment boundaries', () => {
    const args = new PartialArguments()
    args.append(String.raw`{"content":"a\uD83D`)
    expect(args.stringLength('content')).toBe(2)
    expect(args.complete('content')).toBe(false)
    args.append(String.raw`\uDE00\"b"}`)
    expect(args.text('content')).toBe('a😀"b')
    expect(args.stringLength('content')).toBe(5)
    expect(args.complete('content')).toBe(true)
  })

  it('reconciles streamed deltas with authoritative completed arguments', () => {
    const args = new PartialArguments()
    args.append('{"content":"wrong prefix')
    const settled = args.settle('{"content":"authoritative"}')
    expect(settled.text('content')).toBe('authoritative')
    expect(settled.complete('content')).toBe(true)
    expect(() => settled.append('extra')).toThrow()
  })

  it('preserves valid fields before a malformed string without marking it complete', () => {
    const args = PartialArguments.fromText(String.raw`{"file_path":"a.ts","content":"bad\q"}`)
    expect(args.text('content')).toBe('bad')
    expect(args.complete('content')).toBe(false)
    expect(args.text('file_path')).toBe('a.ts')
    expect(args.invalid).toBe(true)
  })
})

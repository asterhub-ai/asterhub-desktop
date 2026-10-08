import { describe, expect, it } from 'vitest'
import { ProjectBindingRevision, ProjectId, createManifest, decodeManifest, manifestDigest, validateRelativeCwd } from '../src/manifest.ts'
import type { PortableProjectManifest } from '../src/types.ts'

const manifest = (): PortableProjectManifest => createManifest({
  id: ProjectId('d2719a2e-650c-49fb-9c98-3c4e0ce61970'), title: 'Portable', createdAt: 1,
})

describe('portable project manifest', () => {
  it('round-trips strict JSON and detects changed confirmation content', () => {
    const source = manifest()
    const bytes = Buffer.from(JSON.stringify(source))
    expect(decodeManifest(bytes)).toEqual(source)
    expect(manifestDigest(bytes)).not.toBe(manifestDigest(Buffer.from(`${bytes.toString()} `)))
  })

  it('validates project IDs and binding revisions before branding', () => {
    expect(String(ProjectId('d2719a2e-650c-49fb-9c98-3c4e0ce61970'))).toBe('d2719a2e-650c-49fb-9c98-3c4e0ce61970')
    expect(String(ProjectBindingRevision('d2719a2e-650c-49fb-9c98-3c4e0ce61970'))).toBe('d2719a2e-650c-49fb-9c98-3c4e0ce61970')
    expect(() => ProjectId('not-a-uuid')).toThrow(/invalid project id/i)
    expect(() => ProjectBindingRevision('not-a-uuid')).toThrow(/invalid project binding revision/i)
  })

  it('rejects invalid and newer metadata rather than treating it as new', () => {
    expect(() => decodeManifest(Buffer.from('{"schemaVersion":2}'))).toThrow(/unsupported/i)
    expect(() => decodeManifest(Buffer.from('{"schemaVersion":1,"schemaVersion":1}'))).toThrow()
    expect(() => decodeManifest(Buffer.from('{'))).toThrow()
  })

  it('accepts only safe project-relative directories', () => {
    expect(validateRelativeCwd('.')).toBe('.')
    expect(validateRelativeCwd('src/nested')).toBe('src/nested')
    for (const path of ['../escape', 'a/../../escape', '/absolute', 'C:/drive', 'a\\b', 'bad\0name']) {
      expect(() => validateRelativeCwd(path)).toThrow()
    }
  })
})

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'

describe('workspace inspection', () => {
  it('inspects an empty directory through the shipped Web Host composition', async () => {
    const scaffold = await launchWebScaffold({ firstUse: true })
    try {
      const path = join(scaffold.workspaceCwd, 'empty-project')
      await mkdir(path)
      const response = await scaffold.hostFetch('/api/workspace/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'workspace-inspect-empty-directory',
          method: 'workspace/inspect',
          payload: { args: { request: { path } } },
        }),
      })
      const body = await response.json() as {
        result: { ok: true; value: { kind: string } } | { ok: false; error: { code: string; message: string } }
      }
      expect(body.result).toMatchObject({ ok: true, value: { kind: 'new' } })
    } finally {
      await scaffold.close()
    }
  })
})

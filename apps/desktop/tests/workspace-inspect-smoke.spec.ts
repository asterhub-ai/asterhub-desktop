import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertWorkspaceInspectResponse } from '../scripts/smoke-runtime.ts'

describe('desktop runtime smoke: workspace inspect validation', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'desktop-workspace-inspect-test-'))
    cleanupDirs.push(dir)
    return dir
  }


  it('fails with exact gateway service-unavailable error and includes response body when workspaceController is unavailable', () => {
    const dir = makeTempDir()
    const gatewayFailureResponse = {
      type: 'server-response',
      rpcId: 'desktop-smoke-workspace-inspect',
      result: {
        ok: false,
        error: {
          code: 'gateway/service-unavailable',
          message: 'active workspaceController unavailable',
        },
      },
    }

    try {
      assertWorkspaceInspectResponse(gatewayFailureResponse, dir)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(String(error)).toContain('gateway/service-unavailable')
      expect(String(error)).toContain('active workspaceController unavailable')
      expect(String(error)).toContain(JSON.stringify(gatewayFailureResponse))
    }
  })

  it('fails if workspace inspection writes private .aster metadata into the inspected directory', () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, '.aster'))
    const response = {
      result: {
        ok: true,
        value: {
          kind: 'new',
        },
      },
    }

    expect(() => { assertWorkspaceInspectResponse(response, dir) }).toThrowError(
      /desktop runtime: workspace inspect wrote private metadata/u,
    )
  })

  it('fails if workspace inspection leaves any modified contents in the empty directory', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'stray.txt'), 'leaked')
    const response = {
      result: {
        ok: true,
        value: {
          kind: 'new',
        },
      },
    }

    expect(() => { assertWorkspaceInspectResponse(response, dir) }).toThrowError(
      /desktop runtime: workspace inspect modified empty directory/u,
    )
  })

  it('fails if workspace inspection returns an unexpected kind or malformed response', () => {
    const dir = makeTempDir()

    expect(() => {
      assertWorkspaceInspectResponse({ result: { ok: true, value: { kind: 'existing' } } }, dir)
    }).toThrowError(/desktop runtime: workspace inspect expected kind 'new', received 'existing'/u)

    expect(() => {
      assertWorkspaceInspectResponse(null, dir)
    }).toThrowError(/desktop runtime: workspace inspect returned malformed response/u)

    expect(() => {
      assertWorkspaceInspectResponse({}, dir)
    }).toThrowError(/desktop runtime: workspace inspect returned malformed response/u)
  })
})

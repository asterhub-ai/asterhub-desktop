import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveWindowsNodePtyAddons } from './build-exe-for-python-sdk-native-pty.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})


describe('resolveWindowsNodePtyAddons', () => {
  it('requires both ConPTY addons from the x64 prebuild', () => {
    const root = temporaryPackage()
    const conpty = createAddon(root, 'prebuilds', 'win32-x64', 'conpty.node')
    const consoleList = createAddon(root, 'prebuilds', 'win32-x64', 'conpty_console_list.node')

    expect(resolveWindowsNodePtyAddons(root, 'x64')).toEqual([conpty, consoleList])
  })

  it('names every missing Windows addon', () => {
    const root = temporaryPackage()

    expect(() => resolveWindowsNodePtyAddons(root, 'x64')).toThrow(
      `Windows node-pty addons are missing: ${join(root, 'prebuilds', 'win32-x64', 'conpty.node')}, ${join(root, 'prebuilds', 'win32-x64', 'conpty_console_list.node')}`,
    )
  })
})

function temporaryPackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-node-pty-addon-'))
  roots.push(root)
  return root
}

function createAddon(root: string, ...segments: string[]): string {
  const path = join(root, ...segments)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  return path
}

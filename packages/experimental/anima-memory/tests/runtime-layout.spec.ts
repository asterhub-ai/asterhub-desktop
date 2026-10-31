import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findJavaHome } from '../src/runtime-layout.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function archiveRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'anima-java-layout-'))
  roots.push(root)
  return root
}

describe('Temurin archive layouts', () => {
  it('accepts archives with the executable directly under the extracted root', async () => {
    const root = await archiveRoot()
    await mkdir(join(root, 'bin'))
    await writeFile(join(root, 'bin', 'java'), '')
    await expect(findJavaHome(root, false)).resolves.toBe(root)
  })

  it('finds Java inside the macOS Contents/Home bundle', async () => {
    const root = await archiveRoot()
    const home = join(root, 'Contents', 'Home')
    await mkdir(join(home, 'bin'), { recursive: true })
    await writeFile(join(home, 'bin', 'java'), '')
    await expect(findJavaHome(root, false)).resolves.toBe(home)
  })

  it('finds the Windows Java executable below an archive wrapper', async () => {
    const root = await archiveRoot()
    const home = join(root, 'jdk')
    await mkdir(join(home, 'bin'), { recursive: true })
    await writeFile(join(home, 'bin', 'java.exe'), '')
    await expect(findJavaHome(root, true)).resolves.toBe(home)
  })
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import test from 'node:test'

const archive = fileURLToPath(new URL('../../../data/releases/asterhub-genoffice-cli-0.11.0-asterhub.1.tgz', import.meta.url))

const call = (client, name, args) => client.callTool({ name, arguments: args })

test('distributed GenOffice MCP CLI writes inside its allowed root and rejects outside paths', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'genoffice-cli-boundary-'))
  const extracted = join(temp, 'dist')
  const project = join(temp, 'moved-project')
  const outside = join(temp, 'outside')
  const home = join(temp, 'home')
  await Promise.all([mkdir(extracted), mkdir(project), mkdir(outside), mkdir(home)])
  let client
  try {
    execFileSync('tar', ['-xzf', archive, '-C', extracted], { stdio: 'ignore' })
    const cli = join(extracted, 'package', 'resources', 'cli', 'genoffice.cjs')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'mcp'],
      cwd: project,
      env: {
        ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
        ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
        ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
        ...(process.env.TEMP === undefined ? {} : { TEMP: process.env.TEMP }),
        ...(process.env.TMP === undefined ? {} : { TMP: process.env.TMP }),
        ELECTRON_RUN_AS_NODE: '1',
        GENOFFICE_ALLOWED_ROOTS: project,
        GENOFFICE_AUDIT_LOG: 'off',
        GENOFFICE_USER_DATA: join(home, 'GenOffice'),
        HOME: home,
        USERPROFILE: home,
        APPDATA: home,
        LOCALAPPDATA: home,
        XDG_CONFIG_HOME: home,
      },
    })
    client = new Client({ name: 'genoffice-boundary-test', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)

    const allowedDoc = join(project, 'allowed.docx')
    const created = await call(client, 'create_docx', { markdown: '# Boundary test', out: allowedDoc })
    assert.notEqual(created.isError, true, JSON.stringify(created))
    assert.equal((await lstat(allowedDoc)).isFile(), true)
    const read = await call(client, 'docs_read', { file: allowedDoc, full: true })
    assert.notEqual(read.isError, true, JSON.stringify(read))

    const outsideDoc = join(outside, 'outside.docx')
    const outsideWrite = await call(client, 'create_docx', { markdown: '# Denied', out: outsideDoc })
    assert.equal(outsideWrite.isError, true)
    await assert.rejects(() => lstat(outsideDoc), { code: 'ENOENT' })

    const traversalDoc = join(outside, 'traversal.docx')
    const traversal = await call(client, 'create_docx', { markdown: '# Denied', out: `../outside/traversal.docx` })
    assert.equal(traversal.isError, true)
    await assert.rejects(() => lstat(traversalDoc), { code: 'ENOENT' })

    await copyFile(allowedDoc, outsideDoc)
    const outsideRead = await call(client, 'docs_read', { file: outsideDoc, full: true })
    assert.equal(outsideRead.isError, true)

    const linkedDir = join(project, 'outside-link')
    await symlink(outside, linkedDir, process.platform === 'win32' ? 'junction' : 'dir')
    const linkedDoc = join(linkedDir, 'linked.docx')
    const linkedWrite = await call(client, 'create_docx', { markdown: '# Denied', out: linkedDoc })
    assert.equal(linkedWrite.isError, true)
    await assert.rejects(() => lstat(join(outside, 'linked.docx')), { code: 'ENOENT' })

    assert.equal((await readFile(allowedDoc)).subarray(0, 2).toString(), 'PK')
  }
  finally {
    await client?.close().catch(() => undefined)
    await rm(temp, { recursive: true, force: true })
  }
})

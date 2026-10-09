/** Boot the materialized target runtime without access to a user's Harness profile. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readPrimaryRuntime, workspaceDependencyPaths } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/**
 * Check Host startup, its matching frontend, external plugins, real Office-to-PDF conversion,
 * and authenticated workspace inspection over an empty directory.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Electron executable.
 * @param runtime - Verified resource descriptor.
 * @param environment - Credential-scrubbed build environment and private native cache.
 * @param resourcesRuntime - Bundled interpreters outside the application archive.
 * @returns Resolves after checks and teardown; rejects on a check or teardown failure.
 */
export async function smokeDesktopRuntime(
  root: string, node: string, runtime: DesktopRuntimeDescriptor, environment: NodeJS.ProcessEnv, resourcesRuntime: string,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const host = new DesktopHostProcess(node, root, profile, undefined, { ...environment, DSH_HOME: home },
    undefined, join(resourcesRuntime, 'primary-runtime'),
    { pnpm: join(resourcesRuntime, 'pnpm', 'bin', 'pnpm.cjs'), nodeBin: join(resourcesRuntime, 'bin') })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    createPluginProfile(profile)
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(profile, 'node_modules', pluginName)
    mkdirSync(plugin, { recursive: true })
    const primary = join(resourcesRuntime, 'primary-runtime')
    const dependencies = workspaceDependencyPaths(primary, await readPrimaryRuntime(primary))
    await promisify(execFile)(dependencies.python, ['-I', '-B',
      fileURLToPath(new URL('../tests/fixtures/office-conversion-inputs.py', import.meta.url)), home],
    { env: environment, timeout: 120_000, windowsHide: true })
    const inputs = ['docx', 'xlsx', 'pptx'].map(extension => ({ extension,
      bytes: readFileSync(join(home, `input.${extension}`)).toString('base64') }))
    const cordis = runtime.sharedPackages.find(entry => entry.name === '@deepseek-ai/cordis')
    if (cordis === undefined) throw new Error('desktop runtime: missing shared Cordis package')
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies: { '@deepseek-ai/cordis': cordis.version }, dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(plugin, 'index.js'), `
import { Context } from '@deepseek-ai/cordis'
import { inspect, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
export const inject = ['webServer', 'officeToPdf', 'skills']
export function apply(ctx) {
  if (!(ctx instanceof Context)) throw new Error('desktop runtime: external plugin loaded another Cordis instance')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke',
    handler(_request, response) { response.end('plugin route ready') } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-office-cli',
    async handler(_request, response) {
      try {
        const skill = await ctx.skills.get('office-docx')
        const json = skill?.content.match(/\\n(\\{\\n[\\s\\S]+)$/u)?.[1]
        if (json === undefined) throw new Error('Office skill did not supply CLI paths')
        const { libreofficeKit: { node, cli } } = JSON.parse(json)
        const options = { cwd: ${JSON.stringify(home)}, env: { ...process.env, PATH: '' }, timeout: 120_000 }
        const capabilities = await promisify(execFile)(node, [cli, 'capabilities'], options)
        const output = ${JSON.stringify(join(home, 'cli.pdf'))}
        await promisify(execFile)(node, [cli, 'convert', '--input', ${JSON.stringify(join(home, 'input.docx'))}, '--output', output], options)
        response.end(JSON.stringify({ capabilities: JSON.parse(capabilities.stdout), pdf: (await readFile(output)).toString('base64') }))
      } catch (error) {
        response.statusCode = 500
        response.end(inspect(error, { depth: 5 }))
      }
    } }))
  for (const input of ${JSON.stringify(inputs)}) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-office/' + input.extension,
      async handler(_request, response) {
        try {
          const bytes = Buffer.from(input.bytes, 'base64')
          const result = await ctx.officeToPdf.convert({ extension: input.extension, priority: 'foreground',
            source: { key: 'desktop-smoke-' + input.extension, version: 'fixture', bytes: bytes.length,
              async read() { return { bytes, version: 'fixture' } } } })
          response.end(Buffer.from(result.pdf))
        } catch (error) {
          response.statusCode = 500
          response.end(inspect(error, { depth: 5 }))
        }
      } }))
  }
}
`)
    writeFileSync(join(plugin, 'bundle.yml'), '- insert:\n    - id: desktop-runtime-smoke-plugin\n      name: desktop-runtime-smoke-plugin\n      inject: [webServer, officeToPdf, skills]\n')
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies[pluginName] = '1.0.0'
    manifest.dsh.profile.bundles.push(pluginName)
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
    const ready = await Promise.race([host.start(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('desktop runtime: Host readiness exceeded 120 seconds')) }, 120_000)
    })])
    clearTimeout(timer)
    const login = await fetch(ready.url, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = await fetch(new URL('/', ready.url), { headers: { cookie } })
    if (response.status !== 200 || !(await response.text()).includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
    const emptyWorkspaceDir = join(home, 'empty-workspace')
    mkdirSync(emptyWorkspaceDir)
    const inspectRpcId = 'desktop-smoke-workspace-inspect'
    const inspectResponse = await fetch(new URL('/api/workspace/inspect', ready.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: inspectRpcId,
        method: 'workspace/inspect',
        payload: { args: { request: { path: emptyWorkspaceDir } } },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!inspectResponse.ok) {
      const responseText = await inspectResponse.text()
      throw new Error(`desktop runtime: workspace inspect HTTP ${inspectResponse.status} ${inspectResponse.statusText}: ${responseText}`)
    }
    const inspectText = await inspectResponse.text()
    let inspectBody: unknown
    try {
      inspectBody = JSON.parse(inspectText)
    } catch (error) {
      throw new Error(`desktop runtime: workspace inspect returned non-JSON response (${inspectResponse.status}): ${inspectText}`, { cause: error })
    }
    assertWorkspaceInspectResponse(inspectBody, emptyWorkspaceDir)
    const pluginResponse = await fetch(new URL('/desktop-smoke', ready.url), { headers: { cookie } })
    const pluginResponseText = await pluginResponse.text()
    if (pluginResponseText !== 'plugin route ready') {
      throw new Error(`desktop runtime: plugin HTTP route failed (${String(pluginResponse.status)}): ${pluginResponseText}`)
    }
    for (const { extension } of inputs) {
      const converted = await fetch(new URL(`/desktop-smoke-office/${extension}`, ready.url), {
        headers: { cookie }, signal: AbortSignal.timeout(120_000),
      })
      if (!converted.ok) throw new Error(`desktop runtime: ${extension} conversion failed: ${await converted.text()}`)
      const pdf = Buffer.from(await converted.arrayBuffer())
      if (!/^%PDF-\d\.\d/u.test(pdf.subarray(0, 8).toString())
        || !pdf.subarray(-1024).toString().trimEnd().endsWith('%%EOF')) {
        throw new Error(`desktop runtime: invalid ${extension} PDF output`)
      }
    }
    const cliResponse = await fetch(new URL('/desktop-smoke-office-cli', ready.url), {
      headers: { cookie }, signal: AbortSignal.timeout(120_000),
    })
    if (!cliResponse.ok) throw new Error(`desktop runtime: skill CLI failed: ${await cliResponse.text()}`)
    const cliResult = await cliResponse.json() as { capabilities: { runtime: { cliPath: string } }; pdf: string }
    if (!cliResult.capabilities.runtime.cliPath.endsWith('cli.js') || Buffer.from(cliResult.pdf, 'base64').subarray(0, 5).toString() !== '%PDF-') {
      throw new Error('desktop runtime: skill CLI did not return capabilities and a PDF')
    }
    console.log('desktop runtime: DOCX, XLSX, PPTX to PDF, skill CLI discovery, and workspace inspect passed')
  } finally {
    clearTimeout(timer)
    await host.stop()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

interface WorkspaceInspectRpcResponse {
  result?: {
    ok: boolean
    value?: {
      kind?: string
      [key: string]: unknown
    }
    error?: {
      code?: string
      message?: string
      [key: string]: unknown
    }
  }
  [key: string]: unknown
}

/**
 * Validate that an authenticated workspace/inspect response succeeded with kind 'new'
 * and that the target directory remains untouched (read-only inspection).
 * @param body - Parsed JSON RPC response from /api/workspace/inspect.
 * @param inspectedPath - Physical directory path supplied to inspect.
 */
export function assertWorkspaceInspectResponse(body: unknown, inspectedPath: string): void {
  if (typeof body !== 'object' || body === null || !('result' in body)) {
    throw new Error(`desktop runtime: workspace inspect returned malformed response\nresponse body: ${JSON.stringify(body)}`)
  }
  const envelope = body as WorkspaceInspectRpcResponse
  if (!envelope.result || envelope.result.ok !== true) {
    const code = envelope.result?.error?.code ?? 'unknown-error'
    const message = envelope.result?.error?.message ?? 'unknown failure'
    throw new Error(`desktop runtime: workspace inspect failed: ${code}: ${message}\nresponse body: ${JSON.stringify(body)}`)
  }
  if (envelope.result.value?.kind !== 'new') {
    throw new Error(`desktop runtime: workspace inspect expected kind 'new', received '${String(envelope.result.value?.kind)}'\nresponse body: ${JSON.stringify(body)}`)
  }
  if (existsSync(join(inspectedPath, '.aster'))) {
    throw new Error(`desktop runtime: workspace inspect wrote private metadata to ${inspectedPath}`)
  }
  const entries = readdirSync(inspectedPath)
  if (entries.length > 0) {
    throw new Error(`desktop runtime: workspace inspect modified empty directory: ${entries.join(', ')}`)
  }
}

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const candidateDir = process.env.ASTERHUB_GENOFFICE_CANDIDATE_DIR
const runtimeDir = process.env.ASTERHUB_GENOFFICE_RUNTIME_DIR
const archivePath = fileURLToPath(new URL('../../../data/releases/asterhub-genoffice-cli-0.11.0-asterhub.1.tgz', import.meta.url))
const upstreamArchiveSha256 = 'b7c7842da8a0f8496188836f16ccfb7ad6c48171ffa16726130bba095536de5f'
const upstreamCliSha256 = '74d7c6209d4a5c51a9a1b7e6fed2227375903a86ba60e5b4e53079c6958f7a46'

function prerequisite(name, value) {
  assert.ok(value, `missing ${name}; bridge integration was not run (no pass may be inferred)`)
  return resolve(value)
}

function importedFrom(requireFrom, name) {
  let resolved
  try {
    resolved = requireFrom.resolve(name)
  }
  catch (cause) {
    throw new Error(`bridge integration prerequisite missing: ${name} is not installed for this runtime`, { cause })
  }
  return import(pathToFileURL(resolved).href)
}
async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function setup(mode = 'workspace-write') {
  const candidate = prerequisite('ASTERHUB_GENOFFICE_CANDIDATE_DIR (installed candidate package directory)', candidateDir)
  const runtime = prerequisite('ASTERHUB_GENOFFICE_RUNTIME_DIR (installed host runtime package directory)', runtimeDir)
  const candidatePackagePath = join(candidate, 'package.json')
  const runtimeRequire = createRequire(join(runtime, 'package.json'))
  const candidateManifest = JSON.parse(await readFile(candidatePackagePath, 'utf8'))
  assert.equal(candidateManifest.version, '0.11.0-asterhub.2', 'candidate path must contain the current bridge package, not the immutable .1 adapter')
  const cli = join(candidate, 'resources', 'cli', 'genoffice.cjs')
  assert.equal((await stat(cli)).isFile(), true, 'candidate install must include separately verified upstream CLI resources')
  assert.equal(await sha256File(archivePath), upstreamArchiveSha256,
    'immutable .1 archive changed; re-verify resource source before staging')
  assert.equal(await sha256File(cli), upstreamCliSha256,
    'candidate CLI payload differs from the source-extracted immutable upstream payload')

  const [cordis, session, sessionCwd, projectStorage, sessionProjection, sandboxPolicy, sandboxLocal, tools, systemPrompt, approval] = await Promise.all([
    importedFrom(runtimeRequire, '@deepseek-ai/cordis'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-session'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-session/cwd'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-project-storage'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-session-projection'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-sandbox-policy'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-sandbox-local'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-tools'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-system-prompt'),
    importedFrom(runtimeRequire, '@deepseek-ai/dsh-user-approval'),
  ])
  const bridge = await import(pathToFileURL(join(candidate, 'index.mjs')).href)
  const originalAllowedRoots = process.env.GENOFFICE_ALLOWED_ROOTS
  const base = await mkdtemp(join(tmpdir(), 'genoffice-bridge-'))
  const profile = join(base, 'profile')
  const currentRoot = join(base, 'current-project')
  const previousRoot = join(base, 'previous-project')
  const outside = join(base, 'external')
  await Promise.all([mkdir(profile), mkdir(currentRoot), mkdir(previousRoot), mkdir(outside)])
  const ctx = new cordis.Context()
  ctx.provide('profileContext', {
    name: 'bridge-integration', dir: profile, patchPath: join(profile, 'cordis.patch.yml'),
    installAnchor: join(profile, 'package.json'), cwd: profile, home: profile,
    startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  delete process.env.GENOFFICE_ALLOWED_ROOTS
  try {
    await ctx.plugin(sessionCwd.default)
    await ctx.plugin(sessionProjection.default)
    await ctx.plugin(projectStorage.default, {
      sessionMode: 'project-local', locatorPath: join(base, 'locator.json'),
      legacySessionRoot: '', metadataLimitBytes: 1024 * 1024, lockDeadlineMs: 5000,
    })
    await ctx.projectStorage.open({ root: currentRoot, mode: 'new' })
    await ctx.plugin(sandboxPolicy.default, { mode })
    await ctx.plugin(sandboxLocal.default)
    await ctx.plugin(systemPrompt.default)
    await ctx.plugin(approval.default)
    await ctx.plugin(tools.default)
    try {
      await ctx.plugin(bridge)
    }
    catch (error) {
      if (process.platform === 'win32' && (error?.code === 'SANDBOX_UNAVAILABLE' || /LogonSID|restricted token|sandbox unavailable/i.test(String(error)))) {
        console.error(`missingrealDesktopuserproof: bridge discovery failed closed before starting a CLI child: ${error?.message ?? error}`)
        return { base, ctx, currentRoot, previousRoot, outside, originalAllowedRoots, expectedFailClosed: true }
      }
      throw error
    }
    const sessionId = session.SessionId(`office-integration-${mode}`)

    const header = {
      version: session.SESSION_FORMAT_VERSION, id: sessionId, createdAt: Date.now(),
      cwd: previousRoot, isSeeded: false, delegationDepth: 0,
    }
    await ctx.projectStorage.bindSession({ ...header, cwd: currentRoot })
    const activeSession = session.Session.create(sessionId, undefined, header)
    const agent = { session: activeSession, options: { cwd: currentRoot } }
    const execution = (tool, args, signal = new AbortController().signal) => ctx.tools.execute({
      callId: `${tool}-${Date.now()}-${Math.random()}`,
      name: `mcp__aster_genoffice__${tool}`, arguments: args, signal, agent,
    })

    let confined
    try {
      confined = await ctx.sandbox.confine([process.execPath, '-e', 'process.exit(0)'], {
        ...ctx.sandboxPolicy.resolve({ session: activeSession }), workspaceRoot: currentRoot,
      })
    }
    catch (error) {
      if (process.platform === 'win32' && (error?.code === 'SANDBOX_UNAVAILABLE' || /LogonSID|restricted token|sandbox unavailable/i.test(String(error)))) {
        console.error(`missingrealDesktopuserproof: ${error?.code ?? error?.message ?? error}; actual Windows sandbox provider failed closed`)
        return { base, ctx, activeSession, execution, currentRoot, previousRoot, outside, originalAllowedRoots, expectedFailClosed: true }
      }
      throw error
    }
    assert.ok(confined && Array.isArray(confined.argv), 'actual ctx.sandbox.confine() must return a confined process argv')
    return { base, ctx, activeSession, execution, currentRoot, previousRoot, outside, originalAllowedRoots, expectedFailClosed: false }
  }
  catch (error) {
    await ctx.fiber.dispose().catch(() => undefined)
    await rm(base, { recursive: true, force: true })
    if (originalAllowedRoots === undefined) delete process.env.GENOFFICE_ALLOWED_ROOTS
    else process.env.GENOFFICE_ALLOWED_ROOTS = originalAllowedRoots
    throw error
  }
}

async function close(state) {
  await state.ctx.fiber.dispose()
  await rm(state.base, { recursive: true, force: true })
  if (state.originalAllowedRoots === undefined) delete process.env.GENOFFICE_ALLOWED_ROOTS
  else process.env.GENOFFICE_ALLOWED_ROOTS = state.originalAllowedRoots
}

function assertToolSuccess(result, label) {
  assert.notEqual(result.isError, true, `${label}: ${JSON.stringify(result.content)}`)
}

test('current bridge executes actual CLI tools under ProjectStorage and host sandbox policy', async (t) => {
  // Dependencies resolve only from the installed candidate and installed host
  // Do not run against raw source or a globally hoisted dependency set.
  assert.ok(candidateDir && runtimeDir, 'isolated candidate and host-runtime installs are prerequisites')
  const state = await setup('workspace-write')
  try {
    if (state.expectedFailClosed) {
      t.skip('missingrealDesktopuserproof: host sandbox capability unavailable; Office effects were not verified')
      return
    }

    const currentDoc = join(state.currentRoot, 'current.docx')
    assertToolSuccess(await state.execution('create_docx', { markdown: '# Current project', out: currentDoc }), 'create in current project')
    assert.equal((await stat(currentDoc)).isFile(), true)
    assertToolSuccess(await state.execution('docs_read', { file: currentDoc, full: true }), 'read current project document')
    await assert.rejects(() => stat(join(state.previousRoot, 'current.docx')), { code: 'ENOENT' })

    const externalDoc = join(state.outside, 'trusted-external.docx')
    await copyFile(currentDoc, externalDoc)
    const externalWrite = await state.execution('create_docx', { markdown: '# External denied', out: join(state.outside, 'outside-write.docx') })
    assert.equal(externalWrite.isError, true, 'workspace-write must deny an outside write')
    await assert.rejects(() => stat(join(state.outside, 'outside-write.docx')), { code: 'ENOENT' })
    // Compare the real CLI with a direct child under the same host policy.
    // The OS decides whether this trusted external read is allowed; the bridge
    // must not introduce a separate cwd-only read filter.
    const readPolicy = {
      ...state.ctx.sandboxPolicy.resolve({ session: state.activeSession }),
      workspaceRoot: state.currentRoot,
    }
    const readProbe = await state.ctx.sandbox.confine([
      process.execPath, '-e',
      'try { require("node:fs").readFileSync(process.argv[1]); process.exit(0) } catch { process.exit(41) }',
      externalDoc,
    ], readPolicy)
    const osRead = spawnSync(readProbe.argv[0], readProbe.argv.slice(1), {
      encoding: 'utf8', timeout: 30_000, windowsHide: true, cwd: state.currentRoot,
    })
    assert.notEqual(osRead.status, null, `actual OS-policy read probe did not exit: ${osRead.signal ?? osRead.error}`)
    assert.equal(osRead.error, undefined, `actual OS-policy read probe failed to launch: ${osRead.error}`)
    const externalRead = await state.execution('docs_read', { file: externalDoc, full: true })
    assert.equal(externalRead.isError, osRead.status !== 0, 'bridge read decision must match the host OS sandbox policy')

    state.activeSession.append('sandbox/mode', { mode: 'read-only' })
    const readOnlyDoc = join(state.currentRoot, 'readonly.docx')
    const readOnlyWrite = await state.execution('create_docx', { markdown: '# Denied read only', out: readOnlyDoc })
    assert.equal(readOnlyWrite.isError, true, 'read-only host policy must deny writes')
    await assert.rejects(() => stat(readOnlyDoc), { code: 'ENOENT' })

    // Real ToolRuntime -> ApprovalService flow, with an outstanding genuine
    // approval question canceled before it can dispatch the MCP child.
    state.activeSession.append('turn/start', { turn: 1 })
    let approvalEntered
    const approvalReady = new Promise((resolve) => { approvalEntered = resolve })
    let releaseApproval
    state.ctx.on('approval/request', async () => {
      approvalEntered()
      return await new Promise((resolve) => { releaseApproval = resolve })
    })
    state.ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === 'mcp__aster_genoffice__create_docx') return { kind: 'ask', reason: 'integration approval cancellation' }
      return next()
    })
    const approvalCanceledPath = join(state.currentRoot, 'approval-canceled.docx')
    const approvalAbort = new AbortController()
    const approvalCall = state.execution('create_docx', { markdown: '# Canceled approval', out: approvalCanceledPath }, approvalAbort.signal)
    await approvalReady
    approvalAbort.abort(new Error('user canceled approval'))
    const approvalResult = await approvalCall
    assert.equal(approvalResult.isError, true, 'canceled approval must prevent tool dispatch')
    releaseApproval?.('allowed-once')
    await assert.rejects(() => stat(approvalCanceledPath), { code: 'ENOENT' })

    const canceledPath = join(state.currentRoot, 'canceled.docx')
    const aborted = new AbortController()
    aborted.abort(new Error('integration cancellation before dispatch'))
    const canceled = await state.execution('create_docx', { markdown: '# Canceled', out: canceledPath }, aborted.signal)
    assert.equal(canceled.isError, true, 'pre-dispatch cancellation must not run the MCP child')
    await assert.rejects(() => stat(canceledPath), { code: 'ENOENT' })
  }
  finally {
    await close(state)
  }
})

test('current bridge uses current root when historical directory has already been removed', async (t) => {
  const state = await setup('workspace-write')
  try {
    if (state.expectedFailClosed) {
      t.skip('missingrealDesktopuserproof: host sandbox capability unavailable; moved-root Office effects were not verified')
      return
    }
    await rm(state.previousRoot, { recursive: true, force: true })
    const movedDoc = join(state.currentRoot, 'moved.docx')
    assertToolSuccess(await state.execution('create_docx', { markdown: '# Moved project', out: movedDoc }), 'create after old root removal')
    assert.equal((await stat(movedDoc)).isFile(), true)
  }
  finally {
    await close(state)
  }
})

test('current bridge denies relative and junction escapes, read-only directories, and approval rejection', async (t) => {
  const state = await setup('workspace-write')
  try {
    if (state.expectedFailClosed) {
      t.skip('missingrealDesktopuserproof: host sandbox capability unavailable; Office effects were not verified')
      return
    }

    const relativeEscape = join(state.outside, 'relative-escape.docx')
    const relativeResult = await state.execution('create_docx', {
      markdown: '# Relative escape', out: '../external/relative-escape.docx',
    })
    assert.equal(relativeResult.isError, true, 'relative traversal outside the current root must be denied')
    await assert.rejects(() => stat(relativeEscape), { code: 'ENOENT' })

    const junction = join(state.currentRoot, 'outside-junction')
    await symlink(state.outside, junction, process.platform === 'win32' ? 'junction' : 'dir')
    const junctionEscape = join(state.outside, 'junction-escape.docx')
    const junctionResult = await state.execution('create_docx', {
      markdown: '# Junction escape', out: join(junction, 'junction-escape.docx'),
    })
    assert.equal(junctionResult.isError, true, 'a directory junction to outside the current root must be denied')
    await assert.rejects(() => stat(junctionEscape), { code: 'ENOENT' })

    const readOnlyDirectory = join(state.currentRoot, 'read-only-directory')
    await mkdir(readOnlyDirectory)
    if (process.platform === 'win32') {
      const denied = spawnSync('icacls', [readOnlyDirectory, '/deny', '*S-1-1-0:(W)'], { encoding: 'utf8', windowsHide: true })
      assert.equal(denied.status, 0, `could not establish a temporary read-only directory ACL: ${denied.stderr}`)
    }
    else {
      await chmod(readOnlyDirectory, 0o555)
    }
    try {
      const readOnlyDirectoryPath = join(readOnlyDirectory, 'directory-denied.docx')
      const readOnlyDirectoryResult = await state.execution('create_docx', {
        markdown: '# Read-only directory', out: readOnlyDirectoryPath,
      })
      assert.equal(readOnlyDirectoryResult.isError, true, 'workspace-write must respect a read-only directory ACL')
      await assert.rejects(() => stat(readOnlyDirectoryPath), { code: 'ENOENT' })
    }
    finally {
      if (process.platform === 'win32') {
        const restored = spawnSync('icacls', [readOnlyDirectory, '/remove:d', '*S-1-1-0'], { encoding: 'utf8', windowsHide: true })
        assert.equal(restored.status, 0, `could not restore the temporary read-only directory ACL: ${restored.stderr}`)
      }
      else {
        await chmod(readOnlyDirectory, 0o755)
      }
    }

    state.activeSession.append('turn/start', { turn: 1 })
    state.ctx.on('approval/request', () => Promise.resolve('rejected'))
    state.ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === 'mcp__aster_genoffice__create_docx') return { kind: 'ask', reason: 'integration approval rejection' }
      return next()
    })
    const rejectedPath = join(state.currentRoot, 'approval-rejected.docx')
    const rejected = await state.execution('create_docx', {
      markdown: '# Rejected approval', out: rejectedPath,
    })
    assert.equal(rejected.isError, true, 'an explicit approval rejection must prevent tool dispatch')
    await assert.rejects(() => stat(rejectedPath), { code: 'ENOENT' })
  }
  finally {
    await close(state)
  }
})

test('installed CLI creates, reads, and validates a DOCX through actual Office render/convert engines', async () => {
  const candidate = prerequisite('ASTERHUB_GENOFFICE_CANDIDATE_DIR (installed candidate package directory)', candidateDir)
  const cli = join(candidate, 'resources', 'cli', 'genoffice.cjs')
  const kitCli = fileURLToPath(new URL('../../../../../packages/document/office-to-pdf/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js', import.meta.url))
  const base = await mkdtemp(join(tmpdir(), 'genoffice-cli-baseline-'))
  const officeRoot = fileURLToPath(new URL('../../../../../packages/document/office-to-pdf/', import.meta.url))
  const officeRequire = createRequire(join(officeRoot, 'package.json'))
  let officeContext
  try {
    const markdown = join(base, 'baseline.md')
    const docx = join(base, 'baseline.docx')
    const pdf = join(base, 'baseline.pdf')
    const officePdf = join(base, 'office-to-pdf.pdf')
    const rendered = join(base, 'rendered')
    await writeFile(markdown, '# W2 baseline\n\nNormal Office authoring, reading, validation, and conversion.', 'utf8')
    const env = { ...process.env, GENOFFICE_ALLOWED_ROOTS: base, GENOFFICE_AUTH_DIR: join(base, 'auth'), GENOFFICE_AUDIT_LOG: 'off' }
    const run = (entry, args, timeout = 120_000) => spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8', timeout, cwd: base, windowsHide: true, env,
    })
    const created = run(cli, ['create', '--type', 'docx', '--from', markdown, '--out', docx])
    assert.equal(created.status, 0, `actual CLI create failed: ${created.stderr}`)
    assert.equal((await stat(docx)).isFile(), true)

    const read = run(cli, ['docs', 'read', docx, '--full'])
    assert.equal(read.status, 0, `actual CLI read failed: ${read.stderr}`)
    assert.match(read.stdout, /Normal Office authoring/u)
    const validated = run(cli, ['info', docx])
    assert.equal(validated.status, 0, `actual CLI document validation failed: ${validated.stderr}`)
    assert.match(validated.stdout, /docx/iu)

    const renderedResult = run(kitCli, ['render', '--input', docx, '--output-dir', rendered])
    assert.equal(renderedResult.status, 0, `actual LibreOffice Kit render failed: ${renderedResult.stderr}`)
    assert.ok((await readdir(rendered)).some((name) => name.endsWith('.png')))
    const converted = run(kitCli, ['convert', '--input', docx, '--output', pdf])
    assert.equal(converted.status, 0, `actual LibreOffice Kit conversion failed: ${converted.stderr}`)
    assert.equal((await readFile(pdf)).subarray(0, 5).toString('ascii'), '%PDF-')

    const cordis = await importedFrom(officeRequire, '@deepseek-ai/cordis')
    const officeModule = await import(pathToFileURL(join(officeRoot, 'lib', 'index.js')).href)
    const source = new Uint8Array(await readFile(docx))
    officeContext = new cordis.Context()
    await officeContext.plugin(officeModule.default)
    const result = await officeContext.officeToPdf.convert({
      extension: 'docx', priority: 'foreground',
      source: {
        key: officeModule.OfficeSourceKey('w2-temp-baseline'), version: 'v1', bytes: source.byteLength,
        read: async () => ({ bytes: source, version: 'v1' }),
      },
    })
    assert.equal(Buffer.from(result.pdf).subarray(0, 5).toString('ascii'), '%PDF-')
  }
  finally {
    if (officeContext) await officeContext.fiber.dispose()
    await rm(base, { recursive: true, force: true })
  }
})

test('bridge teardown exits its CLI child and removes its MCP scratch', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('process-level lifecycle assertion uses the Windows process table')
    return
  }
  const candidate = prerequisite('ASTERHUB_GENOFFICE_CANDIDATE_DIR (installed candidate package directory)', candidateDir)
  const listCandidateChildren = () => {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*genoffice.cjs*" -and $_.CommandLine -like "*genoffice-cli-0.11.0-asterhub.2*" } | ForEach-Object { $_.ProcessId }',
    ], { encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, `could not inspect actual MCP child processes: ${result.stderr}`)
    return result.stdout.trim().split(/\s+/u).filter(Boolean).map(Number)
  }
  const before = new Set(listCandidateChildren())
  const state = await setup('workspace-write')
  let children = []
  try {
    if (state.expectedFailClosed) {
      t.skip('missingrealDesktopuserproof: host sandbox capability unavailable; child lifecycle was not verified')
      return
    }
    const file = join(state.currentRoot, 'child-lifecycle.docx')
    assertToolSuccess(await state.execution('create_docx', { markdown: '# Child lifecycle', out: file }), 'start persistent MCP child')
    children = listCandidateChildren().filter((pid) => !before.has(pid))
    assert.ok(children.length > 0, 'actual installed MCP child process must remain live across tool calls')
  }
  finally {
    await close(state)
  }
  const after = new Set(listCandidateChildren())
  const tempEntries = await readdir(tmpdir())
  for (const pid of children) {
    assert.equal(after.has(pid), false, `MCP child ${pid} survived bridge teardown`)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `MCP child ${pid} survived teardown`)
    assert.equal(tempEntries.some((entry) => entry.startsWith(`genoffice-mcp-${pid}-`)), false,
      `MCP child ${pid} scratch survived teardown`)
  }
})

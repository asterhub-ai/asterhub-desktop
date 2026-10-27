import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const testFile = fileURLToPath(new URL('./local-catalog-install.spec.ts', import.meta.url))
const temp = await mkdtemp(join(tmpdir(), 'asterhub-local-catalog-proof-'))
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: temp, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`)
  return result.stdout.trim()
}
try {
  const version = run('openssl', ['version'])
  if (!/^OpenSSL\s/i.test(version)) throw new Error(`OpenSSL executable did not identify itself as OpenSSL: ${version}`)
  const caKey = join(temp, 'test-ca.key')
  const caCert = join(temp, 'test-ca.pem')
  const serverKey = join(temp, 'server.key')
  const serverCsr = join(temp, 'server.csr')
  const serverCert = join(temp, 'server.pem')
  const extensions = join(temp, 'server.ext')
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caCert, '-days', '1', '-subj', '/CN=AsterHub local catalog test CA'])
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', serverKey, '-out', serverCsr, '-subj', '/CN=localhost'])
  await writeFile(extensions, 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n')
  run('openssl', ['x509', '-req', '-in', serverCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', serverCert, '-days', '1', '-extfile', extensions])
  const pnpm = process.platform === 'win32'
    ? join(root, 'node_modules', '.bin', 'pnpm.CMD')
    : join(root, 'node_modules', '.bin', 'pnpm')
  const result = spawnSync(pnpm, ['exec', 'vitest', 'run', testFile, '--reporter=verbose'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: caCert, ASTERHUB_LOCAL_CATALOG_CERT: serverCert, ASTERHUB_LOCAL_CATALOG_KEY: serverKey },
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
finally {
  await rm(temp, { recursive: true, force: true })
}

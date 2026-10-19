import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { prepareNeo4jRuntime } from '../src/neo4j-runtime.ts'

it('routes official runtime downloads through the build proxy', async () => {
  const seen: string[] = []
  const proxy = createServer((_request, response) => { response.writeHead(502); response.end() })
  proxy.on('connect', (request, socket) => {
    seen.push(request.url ?? '')
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
  })
  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject)
    proxy.listen(0, '127.0.0.1', () => { proxy.off('error', reject); resolve() })
  })
  const root = await mkdtemp(join(tmpdir(), 'anima-egress-'))
  let dispose: (() => Promise<void>) | undefined
  try {
    const address = proxy.address()
    if (address === null || typeof address === 'string') throw new Error('Proxy did not bind a TCP port')
    dispose = await installProxyFromEnvironment({
      get: name => name === 'HTTPS_PROXY' ? { value: `http://127.0.0.1:${address.port}` } : undefined,
    }, () => undefined)
    await expect(prepareNeo4jRuntime({
      platform: 'win32', architecture: 'x64', destination: join(root, 'runtime'), signal: AbortSignal.timeout(5000),
    })).rejects.toThrow()
    expect(seen).toEqual(['dist.neo4j.org:443'])
  } finally {
    await dispose?.()
    await new Promise<void>((resolve, reject) => proxy.close((error) => {
      if (error !== undefined) reject(error)
      else resolve()
    }))
    await rm(root, { recursive: true, force: true })
  }
})

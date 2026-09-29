import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const dataRoot = resolve(process.env.CATALOG_DATA_DIR ?? resolve(root, 'data'))
const catalogSignature = process.env.CATALOG_SIGNATURE_BASE64
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 8080)
const cacheControl = 'public, max-age=60, stale-while-revalidate=300'

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  if (body === undefined) res.end()
  else res.end(body)
}

export function createCatalogServer({ directory = dataRoot, signature } = {}) {
  const dataDirectory = resolve(directory)
  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204)
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, JSON.stringify({ error: 'method_not_allowed' }))
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (pathname === '/healthz') return send(res, 200, JSON.stringify({ status: 'ok' }))
    if (pathname === '/') return send(res, 200, JSON.stringify({ service: 'AsterHub catalog and release metadata', api: '/api/v1/catalog.json' }))
    if (pathname === '/api/v0/check_client_update') {
      return send(res, 200, JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: null } }))
    }

    const isUpdateFeed = pathname.startsWith('/dsh-desk/feeds/')
    const relative = pathname === '/api/v1/catalog.json' ? 'catalog.json'
      : pathname === '/api/v1/desktop/latest.json' ? 'desktop/latest.json'
        : pathname.startsWith('/releases/') ? pathname.slice('/releases/'.length)
          : isUpdateFeed ? pathname.slice('/dsh-desk/feeds/'.length) : undefined
    if (relative === undefined) return send(res, 404, JSON.stringify({ error: 'not_found' }))
    let activeCatalogSignature = signature ?? catalogSignature
    if (relative === 'catalog.json' && activeCatalogSignature === undefined) {
      try { activeCatalogSignature = (await readFile(resolve(dataDirectory, 'catalog.sig'), 'utf8')).trim() }
      catch { activeCatalogSignature = '' }
    }
    if (relative === 'catalog.json' && !isBase64(activeCatalogSignature ?? '')) return send(res, 503, JSON.stringify({ error: 'catalog_signature_unconfigured' }))
    const routeRoot = isUpdateFeed ? resolve(dataDirectory, 'dsh-desk/feeds') : dataDirectory
    const target = resolve(routeRoot, relative)
    if (target !== routeRoot && !target.startsWith(`${routeRoot}${sep}`)) return send(res, 404, JSON.stringify({ error: 'not_found' }))
    try {
      const [realDirectory, realTarget] = await Promise.all([realpath(routeRoot), realpath(target)])
      if (!realTarget.startsWith(`${realDirectory}${sep}`)) return send(res, 404, JSON.stringify({ error: 'not_found' }))
      const body = await readFile(realTarget)
      if (relative === 'catalog.json') {
        const envelope = JSON.stringify({ payload: body.toString('base64'), signature: activeCatalogSignature })
        return send(res, 200, req.method === 'HEAD' ? undefined : envelope)
      }
      const contentType = realTarget.endsWith('.json') ? 'application/json; charset=utf-8'
        : realTarget.endsWith('.yml') || realTarget.endsWith('.yaml') ? 'application/yaml; charset=utf-8'
          : realTarget.endsWith('.zip') ? 'application/zip' : 'application/octet-stream'
      return send(res, 200, req.method === 'HEAD' ? undefined : body, contentType)
    }
    catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return send(res, 404, JSON.stringify({ error: 'not_found' }))
      return send(res, 500, JSON.stringify({ error: 'internal_error' }))
    }
  })
}

function isBase64(value) {
  return value.length > 0 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port')
  createCatalogServer().listen(port, host, () => process.stdout.write(`AsterHub catalog listening on ${host}:${port}\n`))
}

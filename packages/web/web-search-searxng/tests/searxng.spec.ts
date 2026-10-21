import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import WebRuntime from '@deepseek-ai/dsh-web'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import * as SearxngPlugin from '../src/index.ts'
import { SearxngSearchProvider, mapSearxngResponse } from '../src/provider.ts'

const contexts: Context[] = []

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('SearXNG result mapping', () => {
  it('maps URL, title, snippet and publication date while skipping invalid result URLs', () => {
    expect(mapSearxngResponse({ results: [
      { url: 'https://a.test/page', title: 'A', content: 'Useful excerpt', publishedDate: '2026-10-20' },
      { url: 'file:///private', title: 'Not a web result', content: 'ignored' },
      { title: 'Missing URL', content: 'ignored' },
    ] })).toEqual({
      sources: [{ url: 'https://a.test/page', title: 'A', snippet: 'Useful excerpt', publishedAt: '2026-10-20' }],
      truncated: false,
    })
  })

  it('rejects a malformed result envelope instead of silently reporting no matches', () => {
    expect(() => mapSearxngResponse({ results: {} })).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('SearXNG search provider', () => {
  it('uses the current model credential for SearXNG search and maps authenticated results', async () => {
    const keys = ['first-key', 'rotated-key']
    let acceptedKey = 'first-key'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).get('authorization') !== `Bearer ${acceptedKey}`) {
        return new Response(null, { status: 401 })
      }
      return jsonResponse({ results: [{ url: 'https://a.test', title: 'A', content: 'excerpt' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new SearxngSearchProvider({
      apiKey: async () => keys.shift(),
      baseURL: 'https://xapi.fans/asterhub-search/search',
    })

    await expect(provider.search({ query: 'hello world', maxResults: 4 })).resolves.toMatchObject({
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'excerpt' }],
    })
    acceptedKey = 'rotated-key'
    await expect(provider.search({ query: 'second query' })).resolves.toMatchObject({ sources: [{ url: 'https://a.test' }] })

    const [firstInput, firstInit] = fetchMock.mock.calls[0]!
    expect(String(firstInput)).toBe('https://xapi.fans/asterhub-search/search?q=hello+world&format=json')
    expect(firstInit?.method).toBe('GET')
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://xapi.fans/asterhub-search/search?q=second+query&format=json')
  })

  it('fails before network access when the account model key is absent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new SearxngSearchProvider({ apiKey: async () => undefined, baseURL: 'https://xapi.fans/asterhub-search' })

    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
    }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards cancellation and maps an abort to WEB_ABORTED', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(signal)
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new SearxngSearchProvider({ apiKey: async () => 'key', baseURL: 'https://xapi.fans/asterhub-search' })

    await expect(provider.search({ query: 'q' }, signal)).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('SearXNG plugin composition', () => {
  it('registers web_search with the active Host model key', async () => {
    const acceptedKey = 'active-key'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).get('authorization') !== `Bearer ${acceptedKey}`) return new Response(null, { status: 401 })
      return jsonResponse({ results: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebRuntime, { searchProvider: 'asterhub-searxng' })
    const credentials = new MemoryCredentials(ctx)
    const key = credentialKey('asterhub-account', 'model-api-key')
    await credentials.modifyRecord(key, () => Promise.resolve({ kind: 'api-key', key: 'active-key' }))
    const fiber = await ctx.plugin(SearxngPlugin, { baseURL: 'https://xapi.fans/asterhub-search' })

    await expect(ctx.web.search({ query: 'first' })).resolves.toMatchObject({ sources: [] })
    await expect(ctx.web.search({ query: 'second' })).resolves.toMatchObject({ sources: [] })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'after unload' })).rejects.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects non-HTTPS endpoints while loading the plugin', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebRuntime)
    new MemoryCredentials(ctx)

    await expect(ctx.plugin(SearxngPlugin, { baseURL: 'http://xapi.fans/asterhub-search' }))
      .rejects.toThrow(/HTTPS/)
  })
})

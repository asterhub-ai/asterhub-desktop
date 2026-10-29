import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import * as SearxngProvider from '../../../web/web-search-searxng/src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

it('composes SearXNG with the model-facing web_search tool and returns citeable sources', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (new Headers(init?.headers).get('authorization') !== 'Bearer test-sub2api-key') return new Response(null, { status: 401 })
    return new Response(JSON.stringify({
      results: [{ url: 'https://search-result.example/article', title: 'Result title', content: 'Result excerpt' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)

  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(WebRuntime, { searchProvider: 'asterhub-searxng' })
  const credentials = new MemoryCredentials(ctx)
  await ctx.plugin(SearxngProvider, { baseURL: 'https://xapi.fans/asterhub-search' })
  await ctx.plugin(ToolWeb, { search: true, fetch: false })
  await credentials.modifyRecord(credentialKey('asterhub-account', 'model-api-key'), () =>
    Promise.resolve({ kind: 'api-key', key: 'test-sub2api-key' }))

  const batch = await ctx.tools.execute({
    signal: new AbortController().signal,
    calls: [{
      type: 'tool-call',
      id: ToolCallId('web-search-searxng-composition'),
      name: 'web_search',
      arguments: JSON.stringify({ queries: ['AsterHub SearXNG test'] }),
    }],
  })
  const result = batch.results[0]?.result

  const output = (result?.content ?? []).map(block => block.type === 'text' ? block.text : '').join('')
  expect(result?.isError, output).toBe(false)
  expect(output).toContain('Result title')
  expect(output).toContain('https://search-result.example/article')
  expect(output).toContain('Result excerpt')
})

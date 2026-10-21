/**
 * `SearxngSearchProvider`: an authenticated adapter for the AsterHub SearXNG
 * JSON endpoint. It maps public search results to the provider-neutral
 * `ctx.web` source vocabulary and never exposes the Sub2API key to SearXNG.
 * @module @deepseek-ai/dsh-web-search-searxng/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const SEARXNG_PROVIDER_ID = 'asterhub-searxng'

/** Options resolved by the plugin for each operation. */
export interface SearxngSearchProviderOptions {
  /** A trusted HTTPS base URL whose `/search` path returns SearXNG JSON. */
  readonly baseURL: string
  /** Read the active Sub2API model key from Host credentials for this request. */
  readonly apiKey: () => Promise<string | undefined>
}

interface SearxngResult {
  readonly url: string
  readonly title?: string | null
  readonly content?: string | null
  readonly publishedDate?: string | number | null
}

/** Parse one SearXNG result object from the JSON boundary. */
function parseSearxngResult(value: unknown): SearxngResult {
  if (!isRecord(value)) throw new TypeError('result must be an object')
  const { url, title, content, publishedDate } = value
  if (url !== undefined && typeof url !== 'string') throw new TypeError('result url must be a string')
  if (title !== undefined && title !== null && typeof title !== 'string') throw new TypeError('result title must be a string or null')
  if (content !== undefined && content !== null && typeof content !== 'string') throw new TypeError('result content must be a string or null')
  if (publishedDate !== undefined && publishedDate !== null && typeof publishedDate !== 'string' && typeof publishedDate !== 'number') {
    throw new TypeError('result publishedDate must be a string, number, or null')
  }
  return {
    url: url ?? '',
    ...(title === undefined ? {} : { title }),
    ...(content === undefined ? {} : { content }),
    ...(publishedDate === undefined ? {} : { publishedDate }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSearxngResponse(value: unknown): { readonly results: SearxngResult[] } {
  if (!isRecord(value) || !Array.isArray(value.results)) throw new TypeError('response must contain a results array')
  return { results: value.results.map(parseSearxngResult) }
}

/** Map one parsed result to a citeable source; malformed or non-web URLs are dropped. */
function mapSearxngResult(value: SearxngResult): WebSearchSource | undefined {
  if (value.url.length === 0 || !isWebURL(value.url)) return undefined
  const title = value.title?.trim() ?? ''
  const snippet = value.content?.trim() ?? ''
  const publishedAt = typeof value.publishedDate === 'string' ? value.publishedDate.trim() : ''
  return {
    url: value.url,
    ...(title.length > 0 ? { title } : {}),
    ...(snippet.length > 0 ? { snippet } : {}),
    ...(publishedAt.length > 0 ? { publishedAt } : {}),
  }
}

/**
 * Parse SearXNG JSON and map its result envelope to the shared search contract.
 * @param value Decoded SearXNG response JSON.
 * @returns Citeable web sources from the response.
 */
export function mapSearxngResponse(value: unknown): WebSearchResult {
  let response: { readonly results: SearxngResult[] }
  try {
    response = parseSearxngResponse(value)
  } catch (error: unknown) {
    throw new WebError('SearXNG returned an unprocessable response body', 'WEB_PROVIDER_ERROR', { cause: error })
  }
  return {
    sources: response.results
      .map(mapSearxngResult)
      .filter((source): source is WebSearchSource => source !== undefined),
    truncated: false,
  }
}


/** SearXNG-backed web search; redirects fail before credentials can be forwarded. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  /** @param options Trusted endpoint and current account-key reader. */
  constructor(private readonly options: SearxngSearchProviderOptions) {}

  /** @returns Whether the configured endpoint is a safe absolute HTTPS URL. */
  available(): boolean {
    return isValidBaseURL(this.options.baseURL)
  }

  /**
   * Search with the active Sub2API key and return normalized sources.
   * @param request Search query and result limit.
   * @param signal Optional cancellation signal.
   * @returns Normalized sources and truncation state.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {

    if (!this.available()) throw new WebError('SearXNG search endpoint is not configured as an HTTPS URL', 'WEB_PROVIDER_ERROR')
    const apiKey = await this.options.apiKey()
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError('AsterHub Sub2API account is not signed in; sign in before using web search', 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }

    const url = new URL(this.options.baseURL)
    url.pathname = `${url.pathname.replace(/\/+$/u, '').replace(/\/search$/u, '')}/search`
    url.search = ''
    url.searchParams.set('q', request.query)
    url.searchParams.set('format', 'json')

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${apiKey}`,
        },
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError('SearXNG search request failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      throw new WebError(`SearXNG search endpoint returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
    }

    try {
      return mapSearxngResponse(await response.json())
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      if (error instanceof WebError) throw error
      throw new WebError('SearXNG returned an unprocessable response body', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True for an absolute HTTPS endpoint without embedded credentials or query data. */
function isValidBaseURL(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0
      && url.search.length === 0 && url.hash.length === 0
  } catch {
    return false
  }
}

/** True for a web URL that can safely be shown as a search source. */
function isWebURL(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username.length === 0 && url.password.length === 0
  } catch {
    return false
  }
}

/** True for the cancellation error shape used by Fetch. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

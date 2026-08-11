import { CH } from '../../shared/ipc.js'
import type { FetchRequest, FetchResult } from '../../shared/types.js'
import { handle, handleN } from './result.js'

const DEFAULT_MAX_BYTES = 200_000
const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENT = 'flashgent/0.1 (+https://github.com/flashback/flashgent)'

/** Very small HTML -> text pass. Good enough to feed docs pages to a model. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    // Includes the non-breaking space that &nbsp; decodes to.
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchText(url: string, maxBytes: number): Promise<FetchResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http and https URLs are supported (got ${parsed.protocol}).`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/json,*/*' }
    })
  } catch (err) {
    clearTimeout(timer)
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : String(err)
    throw new Error(`Request to ${parsed.host} failed: ${reason}`)
  }
  clearTimeout(timer)

  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()
  const truncated = raw.length > maxBytes
  const body = truncated ? raw.slice(0, maxBytes) : raw
  const text = contentType.includes('html') ? htmlToText(body) : body

  return { url: parsed.toString(), status: response.status, contentType, text, truncated }
}

interface SearchHit {
  title: string
  url: string
  snippet: string
}

/**
 * DuckDuckGo's no-JS endpoint. Keeps search working without an API key, which
 * matters for a local-first tool.
 */
function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const blocks = html.split('<div class="result')

  for (const block of blocks.slice(1, 21)) {
    const linkMatch = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!linkMatch?.[1]) continue

    const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    let url = linkMatch[1]

    // DDG wraps results as /l/?uddg=<encoded>
    const wrapped = /[?&]uddg=([^&]+)/.exec(url)
    if (wrapped?.[1]) url = decodeURIComponent(wrapped[1])
    if (url.startsWith('//')) url = `https:${url}`

    hits.push({
      title: htmlToText(linkMatch[2] ?? ''),
      url,
      snippet: htmlToText(snippetMatch?.[1] ?? '')
    })
  }
  return hits
}

export function registerNetHandlers(): void {
  handle<FetchRequest, FetchResult>(CH.netFetch, (req) =>
    fetchText(req.url, req.maxBytes ?? DEFAULT_MAX_BYTES)
  )

  handleN<FetchResult>(CH.netSearch, async (query: string) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const page = await fetchTextRaw(url)
    const hits = parseDuckDuckGo(page)

    const text = hits.length
      ? hits
          .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
          .join('\n\n')
      : 'No results found.'

    return { url, status: 200, contentType: 'text/plain', text, truncated: false }
  })
}

/** Fetch without the HTML-to-text pass, so the search parser sees real markup. */
async function fetchTextRaw(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    })
    return await response.text()
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : String(err)
    throw new Error(`Search request failed: ${reason}`)
  } finally {
    clearTimeout(timer)
  }
}

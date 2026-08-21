import { CH } from '../../shared/ipc.js'
import type { FetchRequest, FetchResult } from '../../shared/types.js'
import { handle, handleN } from './result.js'

const DEFAULT_MAX_BYTES = 200_000
const REQUEST_TIMEOUT_MS = 20_000
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** Very small HTML -> text pass. Good enough to feed docs pages to a model. */
function htmlToText(html: string): string {
  return (
    html
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
  )
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
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8'
      }
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

function cleanUrl(rawUrl: string): string {
  let url = rawUrl
  const wrapped = /[?&]uddg=([^&]+)/.exec(url)
  if (wrapped?.[1]) url = decodeURIComponent(wrapped[1])
  if (url.startsWith('//')) url = `https:${url}`

  try {
    const u = new URL(url)
    // Strip common tracking parameters
    u.searchParams.delete('utm_source')
    u.searchParams.delete('utm_medium')
    u.searchParams.delete('utm_campaign')
    u.searchParams.delete('utm_term')
    u.searchParams.delete('utm_content')
    u.searchParams.delete('fbclid')
    u.searchParams.delete('gclid')
    return u.toString()
  } catch {
    return url
  }
}

/**
 * DuckDuckGo's no-JS endpoint parser with robust regex matching.
 */
function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const blocks = html.split(/<div[^>]*class="[^"]*result\b[^"]*"/)

  for (const block of blocks.slice(1, 25)) {
    const linkMatch =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
      /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!linkMatch?.[1]) continue

    const snippetMatch =
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div|p)>/i.exec(block)

    const rawUrl = linkMatch[1]
    const url = cleanUrl(rawUrl)
    const title = htmlToText(linkMatch[2] ?? '')
    const snippet = htmlToText(snippetMatch?.[1] ?? '')

    if (title && url) {
      hits.push({ title, url, snippet })
    }
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
          .map((h, i) => `${i + 1}. ${h.title}\n   URL: ${h.url}\n   Snippet: ${h.snippet}`)
          .join('\n\n')
      : 'No results found for query.'

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
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8'
      }
    })
    return await response.text()
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : String(err)
    throw new Error(`Search request failed: ${reason}`)
  } finally {
    clearTimeout(timer)
  }
}

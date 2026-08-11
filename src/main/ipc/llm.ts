import { BrowserWindow } from 'electron'
import { CH, type LlmModelInfo, type LlmStreamRequest, type LlmStreamResult } from '../../shared/ipc.js'
import { logger } from '../logger.js'
import { handle, handleN } from './result.js'

/**
 * The model server, talked to from the main process.
 *
 * This used to live in the renderer, which put it behind the browser's CORS
 * machinery: `Content-Type: application/json` makes every call a preflighted
 * request, and LM Studio answers `OPTIONS /v1/chat/completions` by trying to
 * parse it as a completion and failing with "'messages' field is required".
 * The preflight then fails, the POST is never sent, and the app reports the
 * server as unreachable while the server logs an error about a request nobody
 * meant to make.
 *
 * Main is a Node context: no origin, no preflight, no CORS. The agent loop
 * still lives in the renderer — only the transport moved.
 */

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000

/** In-flight streams, so the renderer can abort one by id. */
const active = new Map<string, AbortController>()

function authHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function trimUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** Turn a failed response into a message the user can act on. */
async function describe(response: Response, baseUrl: string): Promise<string> {
  let detail = response.statusText
  try {
    const body = await response.text()
    const parsed = JSON.parse(body) as { error?: { message?: string } | string }
    detail =
      typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? body.slice(0, 300))
  } catch {
    // Keep the status text.
  }

  if (response.status === 404) {
    return `The endpoint ${baseUrl} answered 404. Check that the URL ends in /v1 and that a model is loaded.`
  }
  if (response.status === 503 || response.status === 429) {
    return `The server is busy and refused the request (${response.status}). Wait for the current generation to finish, then retry.`
  }
  return `The server returned ${response.status}: ${detail}`
}

function unreachable(baseUrl: string, err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') return 'Request cancelled.'
  return (
    `Could not reach the model server at ${baseUrl}. ` +
    `Make sure LM Studio's local server is running (Developer -> Start Server).`
  )
}

export function registerLlmHandlers(): void {
  handleN<LlmModelInfo[]>(CH.llmModels, async (baseUrl: string, apiKey?: string) => {
    const base = trimUrl(baseUrl)

    let response: Response
    try {
      response = await fetch(`${base}/models`, {
        headers: authHeaders(apiKey),
        signal: AbortSignal.timeout(30_000)
      })
    } catch (err) {
      throw new Error(unreachable(base, err))
    }
    if (!response.ok) throw new Error(await describe(response, base))

    const body = (await response.json()) as {
      data?: Array<{ id: string; context_length?: number; max_context_length?: number }>
    }
    const models: LlmModelInfo[] = (body.data ?? []).map((m) => ({
      id: m.id,
      contextLength: m.context_length ?? m.max_context_length ?? null,
      loaded: false,
      capabilities: []
    }))

    // LM Studio's own endpoint carries the context size actually loaded and
    // the model's capabilities. Any other server just will not answer it.
    try {
      const native = await fetch(`${base.replace(/\/v1$/, '')}/api/v0/models`, {
        headers: authHeaders(apiKey),
        signal: AbortSignal.timeout(15_000)
      })
      if (!native.ok) return models

      const detail = (await native.json()) as {
        data?: Array<{
          id: string
          state?: string
          max_context_length?: number
          loaded_context_length?: number
          capabilities?: string[] | string
        }>
      }

      const byId = new Map((detail.data ?? []).map((m) => [m.id, m]))
      return models.map((model) => {
        const extra = byId.get(model.id)
        if (!extra) return model
        const caps = extra.capabilities
        return {
          ...model,
          contextLength: extra.loaded_context_length ?? extra.max_context_length ?? model.contextLength,
          loaded: extra.state === 'loaded',
          capabilities: Array.isArray(caps) ? caps : typeof caps === 'string' ? [caps] : []
        }
      })
    } catch {
      return models
    }
  })

  handle<LlmStreamRequest, LlmStreamResult>(CH.llmStream, async (req) => {
    const base = trimUrl(req.baseUrl)
    const controller = new AbortController()
    active.set(req.requestId, controller)

    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      let response: Response
      try {
        response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: authHeaders(req.apiKey),
          body: JSON.stringify(req.body),
          signal: controller.signal
        })
      } catch (err) {
        return { ok: false, error: unreachable(base, err) }
      }

      if (!response.ok) return { ok: false, error: await describe(response, base) }
      if (!response.body) return { ok: false, error: 'The server returned an empty stream.' }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        forward(req.requestId, decoder.decode(value, { stream: true }))
      }

      return { ok: true }
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, error: 'Request cancelled.', aborted: true }
      logger.error('llm stream failed', String(err))
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
      active.delete(req.requestId)
    }
  })

  handleN<boolean>(CH.llmAbort, (requestId: string) => {
    const controller = active.get(requestId)
    if (!controller) return false
    controller.abort()
    active.delete(requestId)
    return true
  })
}

/** Raw SSE text goes straight to the renderer, which already knows how to parse it. */
function forward(requestId: string, chunk: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CH.evtLlmChunk, requestId, chunk)
  }
}

/** Cancel everything still running, so quitting cannot hang on a slow model. */
export function abortAllStreams(): void {
  for (const controller of active.values()) controller.abort()
  active.clear()
}

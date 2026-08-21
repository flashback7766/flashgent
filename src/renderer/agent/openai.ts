import type { ModelPreset, ToolDefinition } from '@shared/types'
import { getAgentWorker } from '../workers/index.js'

/**
 * Client for the OpenAI-compatible server LM Studio exposes.
 *
 * The HTTP itself happens in the main process. A renderer is a browser
 * context, so `Content-Type: application/json` makes every call a preflighted
 * request, and LM Studio answers `OPTIONS /v1/chat/completions` by trying to
 * parse it as a completion — it fails with "'messages' field is required",
 * the preflight fails, and the POST is never sent. Main has no origin and no
 * preflight. Only the transport moved; the protocol lives here.
 */

/** OpenAI-shaped message, which is what the server speaks. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ModelInfo {
  id: string
  /** Tokens actually available: what is loaded, or the model's ceiling. */
  contextLength: number | null
  /** True when LM Studio reports the model as loaded into memory. */
  loaded: boolean
  /** Capabilities the server advertises, e.g. `tool_use`. Empty if unknown. */
  capabilities: string[]
}

/** Does the server say this model can emit native tool calls? */
export function supportsNativeTools(model: ModelInfo | undefined): boolean | null {
  if (!model || model.capabilities.length === 0) return null
  return model.capabilities.some((c) => /tool/i.test(c))
}

export interface StreamDelta {
  /** Text appended to the assistant's visible answer. */
  text?: string
  /** Reasoning text, when the model exposes it separately. */
  reasoning?: string
  /** Emitted once, when the server reports token usage. */
  usage?: { prompt: number; completion: number; total: number }
}

export interface StreamOutcome {
  text: string
  reasoning: string
  toolCalls: ChatToolCall[]
  /** 'stop' | 'tool_calls' | 'length' | null */
  finishReason: string | null
  usage?: { prompt: number; completion: number; total: number }
}

export class OpenAiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAiError'
  }
}

export class OpenAIApiClient {
  /** Cleared the first time a server rejects the parameter. */
  private reasoningEffortSupported = true
  /** What each model advertises, learned from the last `listModels`. */
  private modelCapabilities = new Map<string, string[]>()

  constructor(
    private baseUrl: string,
    private apiKey?: string
  ) {}

  /** List available models. Doubles as the connection test in Settings. */
  async listModels(): Promise<ModelInfo[]> {
    const result = await window.flashgent.llm.models(this.baseUrl, this.apiKey)
    if (!result.ok) throw new OpenAiError(result.error)

    for (const model of result.value) {
      if (model.capabilities?.length) this.modelCapabilities.set(model.id, model.capabilities)
    }
    return result.value
  }

  /**
   * Pick the dialect the server will accept without complaining.
   *
   * Servers may report each model's capabilities. A model with no reasoning
   * capability only understands `on`/`off`, and sending `medium` makes it log
   * a warning and silently fall back — so send what it actually understands.
   */
  private resolveReasoningEffort(
    model: string,
    requested: 'off' | 'low' | 'medium' | 'high' | null | undefined
  ): string | null {
    if (!requested) return null

    const capabilities = this.modelCapabilities.get(model)
    if (!capabilities) return requested

    const graded = capabilities.some((c) => /reason|think/i.test(c))
    if (graded) return requested

    return requested === 'off' ? 'off' : 'on'
  }

  /**
   * Stream a completion. `onDelta` fires per chunk for live rendering; the
   * resolved value carries the assembled text and any tool calls.
   */
  async streamChat(options: {
    model: string
    messages: ChatMessage[]
    preset: ModelPreset
    tools?: ToolDefinition[]
    /** Sent as `reasoning_effort`; translated or dropped if unsupported. */
    reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | null
    signal: AbortSignal
    onDelta: (delta: StreamDelta) => void
  }): Promise<StreamOutcome> {
    const { model, messages, preset, tools, signal, onDelta } = options

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: preset.temperature,
      max_tokens: preset.maxTokens
    }
    if (preset.topP !== undefined) body.top_p = preset.topP
    if (preset.topK !== undefined) body.top_k = preset.topK
    if (preset.minP !== undefined) body.min_p = preset.minP
    if (preset.repeatPenalty !== undefined) body.repeat_penalty = preset.repeatPenalty
    if (preset.frequencyPenalty !== undefined) body.frequency_penalty = preset.frequencyPenalty
    if (preset.stop?.length) body.stop = preset.stop

    if (this.reasoningEffortSupported) {
      const effort = this.resolveReasoningEffort(model, options.reasoningEffort)
      if (effort) body.reasoning_effort = effort
    }
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))
      body.tool_choice = 'auto'
    }

    const outcome = await this.run(body, signal, onDelta)

    // Some servers reject `reasoning_effort` outright rather than warning.
    if (outcome.error && body.reasoning_effort && /reasoning[_ ]?effort/i.test(outcome.error)) {
      this.reasoningEffortSupported = false
      delete body.reasoning_effort
      const retry = await this.run(body, signal, onDelta)
      if (retry.error) throw new OpenAiError(retry.error)
      return retry.outcome
    }

    if (outcome.error) throw new OpenAiError(outcome.error)
    return outcome.outcome
  }

  /** One attempt: subscribe to chunks, ask main to run it, assemble the result. */
  private async run(
    body: Record<string, unknown>,
    signal: AbortSignal,
    onDelta: (delta: StreamDelta) => void
  ): Promise<{ outcome: StreamOutcome; error?: string }> {
    const requestId = globalThis.crypto.randomUUID()
    const worker = getAgentWorker()

    worker.postMessage({ type: 'SSE_START', id: requestId })

    const workerHandler = (e: MessageEvent) => {
      const data = e.data
      if (data.id !== requestId) return
      if (data.type === 'SSE_DELTA') {
        onDelta(data.delta)
      }
      return
    }
    worker.addEventListener('message', workerHandler)

    const unsubscribe = window.flashgent.on.llmChunk((id, chunk) => {
      if (id === requestId) {
        worker.postMessage({ type: 'SSE_CHUNK', id: requestId, chunk })
      }
    })

    const onAbort = (): void => {
      void window.flashgent.llm.abort(requestId)
    }
    signal.addEventListener('abort', onAbort)

    try {
      if (signal.aborted) {
        return {
          outcome: await this.getWorkerResult(worker, requestId),
          error: 'Request cancelled.'
        }
      }

      const result = await window.flashgent.llm.stream({
        requestId,
        baseUrl: this.baseUrl,
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
        body
      })

      const outcome = await this.getWorkerResult(worker, requestId)

      if (!result.ok) return { outcome, error: result.error }
      if (!result.value.ok) {
        // An abort is the user's doing, not a failure to report.
        if (result.value.aborted || signal.aborted) return { outcome }
        return { outcome, error: result.value.error ?? 'The request failed.' }
      }

      return { outcome }
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      worker.removeEventListener('message', workerHandler)
      worker.postMessage({ type: 'SSE_ABORT', id: requestId }) // cleanup in case of error
    }
  }

  /**
   * Prompts the worker to resolve its parsed chunk data into a final outcome and waits for the response.
   */
  private getWorkerResult(worker: Worker, requestId: string): Promise<StreamOutcome> {
    return new Promise((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.id === requestId && e.data.type === 'SSE_OUTCOME') {
          worker.removeEventListener('message', handler)
          resolve(e.data.outcome)
          return
        }
        return
      }
      worker.addEventListener('message', handler)
      worker.postMessage({ type: 'SSE_RESULT', id: requestId })
    })
  }
}

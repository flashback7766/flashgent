import type { ModelPreset, ToolDefinition } from '@shared/types'

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

/** OpenAI-shaped message, which is what LM Studio's server speaks. */
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

export class LmStudioError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LmStudioError'
  }
}

export class LmStudioClient {
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
    if (!result.ok) throw new LmStudioError(result.error)

    for (const model of result.value) {
      if (model.capabilities.length) this.modelCapabilities.set(model.id, model.capabilities)
    }
    return result.value
  }

  /**
   * Pick the dialect the server will accept without complaining.
   *
   * LM Studio reports each model's capabilities. A model with no reasoning
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
    if (
      outcome.error &&
      body.reasoning_effort &&
      /reasoning[_ ]?effort/i.test(outcome.error)
    ) {
      this.reasoningEffortSupported = false
      delete body.reasoning_effort
      const retry = await this.run(body, signal, onDelta)
      if (retry.error) throw new LmStudioError(retry.error)
      return retry.outcome
    }

    if (outcome.error) throw new LmStudioError(outcome.error)
    return outcome.outcome
  }

  /** One attempt: subscribe to chunks, ask main to run it, assemble the result. */
  private async run(
    body: Record<string, unknown>,
    signal: AbortSignal,
    onDelta: (delta: StreamDelta) => void
  ): Promise<{ outcome: StreamOutcome; error?: string }> {
    const requestId = globalThis.crypto.randomUUID()
    const parser = new SseParser(onDelta)

    const unsubscribe = window.flashgent.on.llmChunk((id, chunk) => {
      if (id === requestId) parser.feed(chunk)
    })

    const onAbort = (): void => {
      void window.flashgent.llm.abort(requestId)
    }
    signal.addEventListener('abort', onAbort)

    try {
      if (signal.aborted) return { outcome: parser.result(), error: 'Request cancelled.' }

      const result = await window.flashgent.llm.stream({
        requestId,
        baseUrl: this.baseUrl,
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
        body
      })

      if (!result.ok) return { outcome: parser.result(), error: result.error }
      if (!result.value.ok) {
        // An abort is the user's doing, not a failure to report.
        if (result.value.aborted || signal.aborted) return { outcome: parser.result() }
        return { outcome: parser.result(), error: result.value.error ?? 'The request failed.' }
      }

      return { outcome: parser.result() }
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
    }
  }
}

/** Accumulates streamed tool-call fragments, which arrive split across chunks. */
interface PartialToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * Incremental server-sent-events parser.
 *
 * Chunk boundaries fall anywhere, including mid-event and mid-JSON, so the
 * buffer is only consumed up to the last complete event.
 */
class SseParser {
  private buffer = ''
  private text = ''
  private reasoning = ''
  private finishReason: string | null = null
  private usage: StreamOutcome['usage']
  private partials = new Map<number, PartialToolCall>()

  constructor(private onDelta: (delta: StreamDelta) => void) {}

  feed(chunk: string): void {
    this.buffer += chunk

    let boundary = this.buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const rawEvent = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      boundary = this.buffer.indexOf('\n\n')
      this.consumeEvent(rawEvent)
    }
  }

  private consumeEvent(rawEvent: string): void {
    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let chunk: SseChunk
      try {
        chunk = JSON.parse(payload) as SseChunk
      } catch {
        continue // A partial line: the next chunk completes it.
      }

      if (chunk.usage) {
        this.usage = {
          prompt: chunk.usage.prompt_tokens ?? 0,
          completion: chunk.usage.completion_tokens ?? 0,
          total: chunk.usage.total_tokens ?? 0
        }
        this.onDelta({ usage: this.usage })
      }

      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) this.finishReason = choice.finish_reason

      const delta = choice.delta
      if (!delta) continue

      if (delta.content) {
        this.text += delta.content
        this.onDelta({ text: delta.content })
      }

      // Reasoning models expose thinking under a couple of different keys.
      const think = delta.reasoning_content ?? delta.reasoning
      if (think) {
        this.reasoning += think
        this.onDelta({ reasoning: think })
      }

      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0
        const existing = this.partials.get(index) ?? { id: '', name: '', arguments: '' }
        if (call.id) existing.id = call.id
        if (call.function?.name) existing.name = call.function.name
        if (call.function?.arguments) existing.arguments += call.function.arguments
        this.partials.set(index, existing)
      }
    }
  }

  result(): StreamOutcome {
    const toolCalls: ChatToolCall[] = [...this.partials.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, p]) => ({
        id: p.id || `call_${index}`,
        type: 'function' as const,
        function: { name: p.name, arguments: p.arguments || '{}' }
      }))
      .filter((c) => c.function.name)

    // Some servers omit finish_reason when they emit tool calls.
    const finishReason = this.finishReason ?? (toolCalls.length ? 'tool_calls' : null)

    const outcome: StreamOutcome = {
      text: this.text,
      reasoning: this.reasoning,
      toolCalls,
      finishReason
    }
    if (this.usage) outcome.usage = this.usage
    return outcome
  }
}

interface SseChunk {
  choices?: Array<{
    finish_reason?: string | null
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

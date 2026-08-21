/**
 * Dedicated Web Worker for heavy renderer-side computation.
 * Offloads synchronous token calculation and LLM JSON parsing (SSE chunks) from the main thread,
 * ensuring UI responsiveness during heavy generations or large context compaction.
 */
import { estimateTokens } from '../lib/tokens.js'
import type { Message } from '@shared/types'
import type { StreamDelta, StreamOutcome } from '../agent/openai.js'

// --- SseParser from openai.ts ---
interface PartialToolCall {
  id: string
  name: string
  arguments: string
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
        // A partial line: the next chunk completes it.
        continue
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
    const toolCalls = [...this.partials.entries()]
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

// --- Worker Message Handling ---

const parsers = new Map<string, SseParser>()

self.onmessage = (e: MessageEvent) => {
  const data = e.data

  if (data.type === 'ESTIMATE_TOKENS') {
    const messages = data.messages as Message[]
    const estimated = messages.reduce((sum, m) => {
      return (
        sum +
        m.blocks.reduce((bSum, b) => {
          if (b.type === 'text') return bSum + estimateTokens(b.text)
          if (b.type === 'tool_use') {
            const inp = JSON.stringify(b.input)
            const res = b.result?.content ?? ''
            return bSum + estimateTokens(inp) + estimateTokens(res)
          }
          return bSum
        }, 0)
      )
    }, 1000)
    self.postMessage({ type: 'TOKENS_ESTIMATED', id: data.id, tokens: estimated })
    return
  }

  if (data.type === 'COMPACT_MESSAGES') {
    const messages = data.messages as Message[]
    const limit = data.limit as number
    const threshold = data.threshold as number
    const promptUsage = data.usage as number | undefined

    const estimated = messages.reduce((sum, m) => {
      return (
        sum +
        m.blocks.reduce((bSum, b) => {
          if (b.type === 'text') return bSum + estimateTokens(b.text)
          if (b.type === 'tool_use') {
            const inp = JSON.stringify(b.input)
            const res = b.result?.content ?? ''
            return bSum + estimateTokens(inp) + estimateTokens(res)
          }
          return bSum
        }, 0)
      )
    }, 1000)

    const used = promptUsage ?? estimated
    const target = Math.floor(limit * threshold)

    if (used > target && messages.length >= 6) {
      const firstMutable = Math.min(2, messages.length)
      const keepRecent = 6
      
      const compacted = [...messages]
      let currentTokens = used
      let droppedCount = 0

      while (currentTokens > target && compacted.length - firstMutable > keepRecent) {
        const removed = compacted.splice(firstMutable, 1)[0]
        if (removed) {
          droppedCount++
          const removedTokens = removed.blocks.reduce((bSum, b) => {
            if (b.type === 'text') return bSum + estimateTokens(b.text)
            if (b.type === 'tool_use') {
              const inp = JSON.stringify(b.input)
              const res = b.result?.content ?? ''
              return bSum + estimateTokens(inp) + estimateTokens(res)
            }
            return bSum
          }, 0)
          currentTokens -= removedTokens
        }
      }

      if (droppedCount > 0) {
        const summaryMessage: Message = {
          id: `compact_${Date.now()}_${Math.random()}`,
          sessionId: compacted[0]?.sessionId || '',
          role: 'user',
          blocks: [{ type: 'text', text: `**Context compressed** — ${droppedCount} earlier messages were pruned.` }],
          model: null,
          createdAt: Date.now()
        }
        compacted.splice(firstMutable, 0, summaryMessage)
        self.postMessage({ type: 'COMPACT_MESSAGES_RESULT', id: data.id, messages: compacted, compacted: true, droppedCount })
        return
      }
    }
    
    self.postMessage({ type: 'COMPACT_MESSAGES_RESULT', id: data.id, messages, compacted: false, droppedCount: 0 })
    return
  }

  if (data.type === 'SSE_START') {
    const parser = new SseParser((delta) => {
      self.postMessage({ type: 'SSE_DELTA', id: data.id, delta })
    })
    parsers.set(data.id, parser)
    return
  }

  if (data.type === 'SSE_CHUNK') {
    const parser = parsers.get(data.id)
    if (parser) parser.feed(data.chunk)
    return
  }

  if (data.type === 'SSE_RESULT') {
    const parser = parsers.get(data.id)
    if (parser) {
      self.postMessage({ type: 'SSE_OUTCOME', id: data.id, outcome: parser.result() })
      parsers.delete(data.id)
    }
    return
  }

  if (data.type === 'SSE_ABORT') {
    parsers.delete(data.id)
    return
  }
  return
}

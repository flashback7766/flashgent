import type { ChatMessage } from './openai.js'

/**
 * Fitting a conversation into the context window.
 *
 * The thing that makes this worth doing carefully is the KV cache: llama.cpp
 * reuses it only while the prompt *prefix* is byte-identical to last time. The
 * obvious approach — drop the oldest message whenever you are over budget —
 * changes the prefix on every single turn and forces a full re-prefill each
 * time. On an integrated GPU that is the difference between a two-second turn
 * and a two-minute one.
 *
 * So this does the opposite of nibbling:
 *
 *  1. Do nothing at all until the window is genuinely tight.
 *  2. When it is, cut well past the threshold, so the next several turns need
 *     no change and the prefix stays stable.
 *  3. Drop the cheapest thing first — stale tool *results*, keeping the calls
 *     themselves — before dropping any conversation.
 *  4. Only then collapse the middle into a checkpoint.
 */

/** Rough token estimate. Good enough for budgeting, never billed on. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

export function messageTokens(message: ChatMessage): number {
  return (
    estimateTokens(message.content ?? '') +
    estimateTokens(message.tool_calls ? JSON.stringify(message.tool_calls) : '') +
    8 // role, delimiters and other per-message overhead
  )
}

export function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0)
}

export interface BudgetOptions {
  /** Full window, or null when the server did not report one. */
  contextTokens: number | null
  /** Share of the window the prompt may fill. */
  utilisation: number
  /** Tokens to leave for the reply. */
  reserve: number
  /** Recent messages always kept verbatim. */
  keepRecent?: number
}

export interface ContextPlan {
  messages: ChatMessage[]
  /** Tool results whose bodies were replaced with a stub. */
  elidedResults: number
  /** Messages folded into the checkpoint. */
  checkpointed: number
  /** True when anything before the tail changed, so the cache is cold. */
  prefixChanged: boolean
}

const ELIDED = '[result dropped to free context — call the tool again if you need it]'

/**
 * How deep to cut once cutting starts. Trimming to exactly the limit would
 * put us back over it on the very next turn, and each of those turns would
 * cost a full re-prefill.
 */
const TARGET_SHARE = 0.6

export function planContext(wire: ChatMessage[], options: BudgetOptions): ContextPlan {
  const untouched: ContextPlan = {
    messages: wire,
    elidedResults: 0,
    checkpointed: 0,
    prefixChanged: false
  }

  if (!options.contextTokens) return untouched

  const limit = Math.floor(options.contextTokens * options.utilisation) - options.reserve
  if (limit <= 0 || totalTokens(wire) <= limit) return untouched

  const keepRecent = options.keepRecent ?? 6
  const target = Math.floor(limit * TARGET_SHARE)

  // Index 0 is the system prompt and index 1 the user's original request:
  // both anchor the conversation and are never touched.
  const firstMutable = Math.min(2, wire.length)
  const lastMutable = Math.max(firstMutable, wire.length - keepRecent)
  const messages = [...wire]
  let elidedResults = 0

  // --- 1. stale tool results ------------------------------------------------
  for (let i = firstMutable; i < lastMutable && totalTokens(messages) > target; i++) {
    const message = messages[i]
    if (!message || message.role !== 'tool') continue
    if (message.content === ELIDED) continue

    messages[i] = { ...message, content: ELIDED }
    elidedResults++
  }

  if (totalTokens(messages) <= target) {
    return { messages, elidedResults, checkpointed: 0, prefixChanged: elidedResults > 0 }
  }

  // --- 2. checkpoint the middle --------------------------------------------
  // Always measured against the live array: splicing shifts everything down,
  // so a bound captured from the original length would drift.
  const dropped: ChatMessage[] = []
  while (messages.length - firstMutable > keepRecent && totalTokens(messages) > target) {
    const removed = messages.splice(firstMutable, 1)[0]
    if (removed) dropped.push(removed)
  }

  if (dropped.length > 0) {
    messages.splice(firstMutable, 0, { role: 'user', content: buildCheckpoint(dropped) })
  }

  return { messages, elidedResults, checkpointed: dropped.length, prefixChanged: true }
}

/**
 * A checkpoint stands in for the turns it replaces, so it has to carry what
 * the agent would otherwise have to rediscover: what it already did.
 * Built mechanically — an extra model call to summarise would cost more than
 * the tokens it saves.
 */
function buildCheckpoint(dropped: ChatMessage[]): string {
  const tools = new Map<string, Set<string>>()

  for (const message of dropped) {
    for (const call of message.tool_calls ?? []) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments) as Record<string, unknown>
      } catch {
        // A subject is a nicety; skip it rather than fail.
      }
      const subject = Object.values(args).find((v) => typeof v === 'string')
      const seen = tools.get(call.function.name) ?? new Set<string>()
      if (typeof subject === 'string' && subject) seen.add(subject.slice(0, 80))
      tools.set(call.function.name, seen)
    }
  }

  const lines = [`[checkpoint] ${dropped.length} earlier messages were dropped to free context.`]

  if (tools.size) {
    lines.push('Already done:')
    for (const [name, subjects] of tools) {
      const list = [...subjects].slice(0, 6).join(', ')
      lines.push(`- ${name}${list ? `: ${list}` : ''}`)
    }
  }

  lines.push('Re-read anything you still need rather than assuming it is unchanged.')
  return lines.join('\n')
}

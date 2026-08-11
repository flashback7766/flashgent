/**
 * Splits reasoning regions out of a streaming completion.
 *
 * Models without native reasoning are asked to wrap their reasoning in a tag,
 * and they write it wrong often enough that exact matching is not an option.
 * Seen in the wild: `<thinking ` with no closing bracket, `<Thinking>`,
 * `<think>`, attributes inside the tag. All of it has to be recognised —
 * a tag that leaks into the transcript is worse than no tag at all.
 *
 * The tag also arrives split across arbitrary chunk boundaries, so the
 * splitter holds back any suffix that could still turn out to be the start of
 * one, and releases text only once it is certain it is not.
 */

const NAMES = 'thinking|reasoning|thought|think'

/**
 * Tolerates attributes and a missing `>`.
 *
 * The bracket group is optional *and* excludes `<`, which is what makes a
 * bracket-less tag work: in `<thinking reasoning </thinking>` the attribute
 * run stops at the `<`, the group fails, and only `<thinking` is consumed —
 * leaving the close tag to be found normally. A plain `[^>]*` would have
 * swallowed it.
 */
const OPEN = new RegExp(`<\\s*(?:${NAMES})\\b(?:[^<>]*>)?`, 'i')
const CLOSE = new RegExp(`<\\s*/\\s*(?:${NAMES})\\b(?:[^<>]*>)?`, 'i')

/**
 * Prefixes a partial tag could still grow into. Deliberately without the
 * closing bracket, so `<thin` is held but `<b` is released at once.
 */
const OPEN_PREFIXES = ['<thinking', '<reasoning', '<thought', '<think']
const CLOSE_PREFIXES = ['</thinking', '</reasoning', '</thought', '</think']

export interface SplitOutput {
  text: string
  thinking: string
}

/** Length of the longest suffix of `value` that is a prefix of one of `tags`. */
function heldBackLength(value: string, tags: string[]): number {
  const longest = Math.max(...tags.map((t) => t.length))
  const limit = Math.min(value.length, longest)

  for (let length = limit; length > 0; length--) {
    const suffix = value.slice(value.length - length).toLowerCase()
    if (tags.some((tag) => tag.startsWith(suffix))) return length
  }
  return 0
}

export class ThinkingSplitter {
  private buffer = ''
  private inside = false

  /** Feed one streamed chunk; returns whatever became unambiguous. */
  feed(chunk: string): SplitOutput {
    this.buffer += chunk

    let text = ''
    let thinking = ''

    for (;;) {
      const prefixes = this.inside ? CLOSE_PREFIXES : OPEN_PREFIXES

      // Work out the tail that could still grow into a tag *before* matching.
      // Searching the whole buffer would let `\b` succeed at its end, so a
      // half-arrived `<think` would match as a complete tag and the `ing>`
      // would leak into the transcript.
      const hold = heldBackLength(this.buffer, prefixes)
      const searchable = this.buffer.slice(0, this.buffer.length - hold)

      const match = (this.inside ? CLOSE : OPEN).exec(searchable)
      if (match) {
        const before = this.buffer.slice(0, match.index)
        if (this.inside) thinking += before
        else text += before

        this.buffer = this.buffer.slice(match.index + match[0].length)
        this.inside = !this.inside
        continue
      }

      this.buffer = this.buffer.slice(searchable.length)
      if (this.inside) thinking += searchable
      else text += searchable
      break
    }

    return { text, thinking }
  }

  /** Release whatever is still held back once the stream ends. */
  flush(): SplitOutput {
    const remainder = this.buffer
    this.buffer = ''
    return this.inside ? { text: '', thinking: remainder } : { text: remainder, thinking: '' }
  }

  /** True when the model opened a reasoning region and never closed it. */
  get unterminated(): boolean {
    return this.inside
  }
}

/** Strip reasoning regions from a completed string, in one pass. */
export function splitThinking(raw: string): SplitOutput {
  const splitter = new ThinkingSplitter()
  const streamed = splitter.feed(raw)
  const tail = splitter.flush()
  return {
    text: streamed.text + tail.text,
    thinking: streamed.thinking + tail.thinking
  }
}

/**
 * Structural wrappers a model puts around its answer — `<answer>…</answer>`,
 * `<final>…</final>`. Not content: the tags go, what is inside stays.
 */
const WRAPPER_NAMES = 'answer|final|response|output|result'

/**
 * Last-resort cleanup for markup that slipped past the splitter — a reasoning
 * tag in a shape we never anticipated, or a structural wrapper around the
 * answer. Both markers are removed; only reasoning tags take their contents
 * with them (the splitter handled the real regions, so a leftover here is a
 * stray marker, not a region).
 */
export function stripStrayTags(text: string): string {
  return text
    .replace(new RegExp(`<\\s*/?\\s*(?:${NAMES})\\b(?:[^<>]*>)?`, 'gi'), '')
    .replace(new RegExp(`<\\s*/?\\s*(?:${WRAPPER_NAMES})\\b(?:[^<>]*>)?`, 'gi'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * "almost done thinking" — shown once the reasoning approaches the budget the
 * current effort level allots it.
 */
export function nearingThinkingBudget(thinking: string, budgetTokens: number): boolean {
  if (budgetTokens <= 0) return false
  return Math.ceil(thinking.length / 3.5) >= budgetTokens * 0.8
}

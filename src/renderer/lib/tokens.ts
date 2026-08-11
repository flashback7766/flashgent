import type { ContentBlock } from '@shared/types'

/** Rough estimate for code, JSON and prose. Matches BPE tokenizer averages. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 2.8)
}

/**
 * Tokens a turn is worth, counting the tool traffic the model actually had to
 * read: call arguments and results included, raw command output excluded.
 *
 * Shell output is the one thing that can run to tens of thousands of
 * characters for a single call, so including it would make the readout a
 * measure of how chatty a build script is rather than how much work the model
 * did.
 */
export function estimateTurnTokens(blocks: ContentBlock[]): number {
  let total = 0

  for (const block of blocks) {
    if (block.type === 'text' || block.type === 'thinking') {
      total += estimateTokens(block.text)
      continue
    }

    total += estimateTokens(block.name) + estimateTokens(JSON.stringify(block.input))

    const result = block.result
    if (!result || result.display?.kind === 'shell') continue
    total += estimateTokens(result.content)
  }

  return total
}

import { describe, expect, it } from 'vitest'
import { estimateTurnTokens } from '../../src/renderer/lib/tokens.js'
import type { ContentBlock } from '../../src/shared/types.js'

const tool = (
  name: string,
  content: string,
  kind: 'shell' | 'file' | 'plain'
): ContentBlock => ({
  type: 'tool_use',
  id: `${name}-1`,
  name,
  input: { path: 'a.ts' },
  status: 'ok',
  result: { ok: true, content, display: { kind } }
})

describe('estimateTurnTokens', () => {
  it('counts prose and reasoning', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'x'.repeat(350) },
      { type: 'thinking', text: 'y'.repeat(350) }
    ]
    expect(estimateTurnTokens(blocks)).toBeGreaterThanOrEqual(200)
  })

  it('counts tool calls and their results', () => {
    const withTool = estimateTurnTokens([tool('read_file', 'z'.repeat(700), 'file')])
    const bare = estimateTurnTokens([
      { type: 'tool_use', id: 't', name: 'read_file', input: { path: 'a.ts' }, status: 'ok' }
    ])
    expect(withTool).toBeGreaterThan(bare)
  })

  it('leaves raw command output out of the count', () => {
    const noisy = estimateTurnTokens([tool('run_shell', 'log line\n'.repeat(5000), 'shell')])
    const quiet = estimateTurnTokens([tool('run_shell', '', 'shell')])

    // The command itself still counts; its output does not.
    expect(noisy).toBe(quiet)
  })

  it('still counts a file read of the same size', () => {
    const big = 'q'.repeat(40_000)
    expect(estimateTurnTokens([tool('read_file', big, 'file')])).toBeGreaterThan(10_000)
  })

  it('is zero for an empty turn', () => {
    expect(estimateTurnTokens([])).toBe(0)
  })
})

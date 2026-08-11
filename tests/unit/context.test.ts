import { describe, expect, it } from 'vitest'
import { contextBreakdown, sharePercent } from '../../src/renderer/lib/context.js'
import { defaultConfig } from '../../src/shared/config.js'
import type { Message, ToolDefinition } from '../../src/shared/types.js'

const config = defaultConfig()

const tool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a file.',
  risk: 'read',
  parameters: { type: 'object', properties: { path: { type: 'string' } } }
}

const message = (blocks: Message['blocks']): Message => ({
  id: crypto.randomUUID(),
  sessionId: 's',
  role: 'assistant',
  blocks,
  model: null,
  createdAt: 0
})

const base = {
  messages: [] as Message[],
  mcpTools: [],
  builtinTools: [tool],
  config,
  attachments: [] as Array<{ path: string; content: string }>,
  projectInstructions: '',
  limit: 100_000 as number | null
}

describe('contextBreakdown', () => {
  it('separates prose from tool traffic', () => {
    const result = contextBreakdown({
      ...base,
      messages: [
        message([
          { type: 'text', text: 'x'.repeat(3500) },
          {
            type: 'tool_use',
            id: 't',
            name: 'read_file',
            input: { path: 'a.ts' },
            status: 'ok',
            result: { ok: true, content: 'y'.repeat(7000) }
          }
        ])
      ]
    })

    const messages = result.slices.find((s) => s.id === 'messages')
    const prose = messages?.children?.find((c) => c.id === 'messages-prose')
    const tools = messages?.children?.find((c) => c.id === 'messages-tools')

    expect(prose?.tokens).toBeGreaterThan(900)
    expect(tools?.tokens).toBeGreaterThan(prose?.tokens ?? 0)
    // Messages is the sum of its parts.
    expect(messages?.tokens).toBe((prose?.tokens ?? 0) + (tools?.tokens ?? 0))
  })

  it('counts command output, unlike the per-turn figure', () => {
    const withOutput = contextBreakdown({
      ...base,
      messages: [
        message([
          {
            type: 'tool_use',
            id: 't',
            name: 'run_shell',
            input: { command: 'npm run build' },
            status: 'ok',
            result: { ok: true, content: 'log\n'.repeat(5000), display: { kind: 'shell' } }
          }
        ])
      ]
    })

    const tools = withOutput.slices
      .find((s) => s.id === 'messages')
      ?.children?.find((c) => c.id === 'messages-tools')
    expect(tools?.tokens).toBeGreaterThan(5000)
  })

  it('breaks MCP down per server, largest first', () => {
    const result = contextBreakdown({
      ...base,
      mcpTools: [
        { server: 'small', name: 'a', description: 'x', inputSchema: {} },
        { server: 'big', name: 'b', description: 'y'.repeat(4000), inputSchema: {} }
      ]
    })

    const mcp = result.slices.find((s) => s.id === 'mcp')
    expect(mcp?.children?.map((c) => c.label)).toEqual(['big', 'small'])
  })

  it('leaves out categories that cost nothing', () => {
    const result = contextBreakdown(base)
    expect(result.slices.some((s) => s.id === 'mcp')).toBe(false)
    expect(result.slices.some((s) => s.id === 'attachments')).toBe(false)
    // The system prompt is always there.
    expect(result.slices.some((s) => s.id === 'system')).toBe(true)
  })

  it('reports free space against the window', () => {
    const result = contextBreakdown({ ...base, limit: 100_000 })
    expect(result.free).toBe(100_000 - result.used)
  })

  it('never reports negative free space', () => {
    const result = contextBreakdown({
      ...base,
      limit: 10,
      messages: [message([{ type: 'text', text: 'x'.repeat(50_000) }])]
    })
    expect(result.free).toBe(0)
  })
})

describe('sharePercent', () => {
  it('is a share of the window when one is known', () => {
    expect(sharePercent(250, 1000, 500)).toBe(25)
  })

  it('falls back to a share of what is used', () => {
    expect(sharePercent(250, null, 500)).toBe(50)
  })

  it('is zero rather than NaN when there is nothing to divide by', () => {
    expect(sharePercent(0, null, 0)).toBe(0)
  })
})

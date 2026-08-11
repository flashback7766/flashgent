import type { McpToolInfo } from '@shared/ipc'
import type { AppConfig, ContentBlock, Message, ToolDefinition } from '@shared/types'
import { estimateTokens } from './tokens.js'

/**
 * Where the context window actually goes.
 *
 * This is deliberately separate from the turn-token readout: that one leaves
 * raw command output out because it distorts "how much work was done", while
 * this one must count every character the model is made to read. If a build
 * log is eating half the window, hiding it would defeat the purpose.
 */
export interface ContextSlice {
  id: string
  label: string
  tokens: number
  /** Tailwind background class for the swatch. */
  colour: string
  children?: ContextSlice[]
}

export interface ContextBreakdown {
  slices: ContextSlice[]
  used: number
  free: number
  limit: number | null
}

export interface BreakdownInput {
  messages: Message[]
  mcpTools: McpToolInfo[]
  builtinTools: ToolDefinition[]
  config: AppConfig
  attachments: Array<{ path: string; content: string }>
  /** Contents of FLASHGENT.md / CLAUDE.md, if any were loaded. */
  projectInstructions: string
  limit: number | null
}

/** Rough size of the fixed instruction block, measured once. */
const SYSTEM_PROMPT_BASE_TOKENS = 900

function messageProse(blocks: ContentBlock[]): number {
  let total = 0
  for (const block of blocks) {
    if (block.type === 'text' || block.type === 'thinking') total += estimateTokens(block.text)
  }
  return total
}

function toolTraffic(blocks: ContentBlock[]): number {
  let total = 0
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue
    total += estimateTokens(block.name) + estimateTokens(JSON.stringify(block.input))
    // Command output counts here: it is really in the prompt.
    if (block.result) total += estimateTokens(block.result.content)
  }
  return total
}

function schemaTokens(definitions: Array<{ name: string; description: string; parameters?: unknown }>): number {
  return definitions.reduce(
    (sum, d) =>
      sum +
      estimateTokens(d.name) +
      estimateTokens(d.description) +
      estimateTokens(JSON.stringify(d.parameters ?? {})),
    0
  )
}

export function contextBreakdown(input: BreakdownInput): ContextBreakdown {
  const prose = input.messages.reduce((sum, m) => sum + messageProse(m.blocks), 0)
  const tools = input.messages.reduce((sum, m) => sum + toolTraffic(m.blocks), 0)

  const systemPrompt =
    SYSTEM_PROMPT_BASE_TOKENS +
    estimateTokens(input.config.agent.persona) +
    estimateTokens(input.projectInstructions)

  const builtin = schemaTokens(input.builtinTools)

  // MCP breaks down per server, since one chatty server can dominate.
  const perServer = new Map<string, number>()
  for (const tool of input.mcpTools) {
    const cost =
      estimateTokens(tool.name) +
      estimateTokens(tool.description) +
      estimateTokens(JSON.stringify(tool.inputSchema ?? {}))
    perServer.set(tool.server, (perServer.get(tool.server) ?? 0) + cost)
  }
  const mcp = [...perServer.values()].reduce((a, b) => a + b, 0)

  const attachments = input.attachments.reduce((sum, a) => sum + estimateTokens(a.content), 0)

  const slices: ContextSlice[] = [
    {
      // Tool traffic is part of the conversation as far as the model is
      // concerned, so it belongs under Messages — with a breakdown for when
      // you need to know which half is the problem.
      id: 'messages',
      label: 'Messages',
      tokens: prose + tools,
      colour: 'bg-brand',
      children: [
        { id: 'messages-prose', label: 'Prose & reasoning', tokens: prose, colour: 'bg-brand' },
        { id: 'messages-tools', label: 'Tool calls & results', tokens: tools, colour: 'bg-ok' }
      ].filter((child) => child.tokens > 0)
    },
    { id: 'system', label: 'System prompt', tokens: systemPrompt, colour: 'bg-warn' },
    { id: 'builtin', label: 'Built-in tool schemas', tokens: builtin, colour: 'bg-muted' },
    {
      id: 'mcp',
      label: 'MCP tool schemas',
      tokens: mcp,
      colour: 'bg-faint',
      children: [...perServer.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([server, tokens]) => ({
          id: `mcp-${server}`,
          label: server,
          tokens,
          colour: 'bg-faint'
        }))
    },
    { id: 'attachments', label: 'Pending attachments', tokens: attachments, colour: 'bg-bad' }
  ].filter((slice) => slice.tokens > 0)

  const used = slices.reduce((sum, slice) => sum + slice.tokens, 0)
  const free = input.limit === null ? 0 : Math.max(0, input.limit - used)

  return { slices, used, free, limit: input.limit }
}

export function sharePercent(tokens: number, limit: number | null, used: number): number {
  const denominator = limit ?? used
  if (!denominator) return 0
  return (tokens / denominator) * 100
}

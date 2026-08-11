import type { McpToolInfo } from '@shared/ipc'
import type { JSONSchema, ToolDefinition, ToolResult } from '@shared/types'
import { BUILTIN_BY_NAME, BUILTIN_TOOLS, type BuiltinTool, type ToolContext } from './builtin.js'

/** MCP tool names are namespaced so two servers can both expose "search". */
export const MCP_SEPARATOR = '__'

export interface RegisteredTool {
  definition: ToolDefinition
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

/** MCP servers hand us arbitrary JSON Schema; keep only what we model. */
function coerceSchema(schema: unknown): JSONSchema {
  const fallback: JSONSchema = { type: 'object', properties: {} }
  if (!schema || typeof schema !== 'object') return fallback

  const s = schema as { properties?: unknown; required?: unknown }
  const properties =
    s.properties && typeof s.properties === 'object'
      ? (s.properties as JSONSchema['properties'])
      : {}
  const required = Array.isArray(s.required) ? (s.required as string[]) : undefined

  return required ? { type: 'object', properties, required } : { type: 'object', properties }
}

function mcpTool(info: McpToolInfo): RegisteredTool {
  const name = `${info.server}${MCP_SEPARATOR}${info.name}`
  return {
    definition: {
      name,
      description: info.description || `MCP tool ${info.name} from ${info.server}`,
      parameters: coerceSchema(info.inputSchema),
      // We cannot know what an MCP tool does internally, so it is always gated
      // behind a permission prompt unless the user allowlists it.
      risk: 'execute',
      server: info.server
    },
    async execute(input) {
      const result = await window.flashgent.mcp.call(info.server, info.name, input)
      if (!result.ok) throw new Error(result.error)
      return {
        ok: !result.value.isError,
        content: result.value.content || '(empty result)',
        display: { kind: 'plain', title: name }
      }
    }
  }
}

/** Build the tool set the model will see for a turn. */
export function buildRegistry(
  mcpTools: McpToolInfo[],
  extras: BuiltinTool[] = []
): Map<string, RegisteredTool> {
  const registry = new Map<string, RegisteredTool>()

  for (const tool of [...BUILTIN_TOOLS, ...extras]) {
    registry.set(tool.definition.name, { definition: tool.definition, execute: tool.execute })
  }
  for (const info of mcpTools) {
    const tool = mcpTool(info)
    // Built-ins win a name clash; MCP names are already namespaced so this is
    // only reachable if a server is literally called e.g. "read_file".
    if (!registry.has(tool.definition.name)) registry.set(tool.definition.name, tool)
  }
  return registry
}

export function isBuiltin(name: string): boolean {
  return BUILTIN_BY_NAME.has(name)
}

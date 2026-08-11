import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import { BrowserWindow } from 'electron'
import { CH, type McpStatus, type McpToolInfo } from '../../shared/ipc.js'
import type { McpServerConfig } from '../../shared/types.js'
import { readConfig } from '../configStore.js'
import { logger } from '../logger.js'
import { handle, handleN } from './result.js'

interface Connection {
  config: McpServerConfig
  client: Client
  tools: McpToolInfo[]
  error: string | null
}

const connections = new Map<string, Connection>()

function statusOf(config: McpServerConfig): McpStatus {
  const live = connections.get(config.id)
  return {
    id: config.id,
    name: config.name,
    connected: Boolean(live),
    error: live?.error ?? null,
    toolCount: live?.tools.length ?? 0
  }
}

function allStatuses(): McpStatus[] {
  return readConfig().mcpServers.map(statusOf)
}

function broadcastStatus(): void {
  const statuses = allStatuses()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CH.evtMcpStatus, statuses)
  }
}

type McpTransport = Parameters<Client['connect']>[0]

function buildTransport(config: McpServerConfig): McpTransport {
  switch (config.transport) {
    case 'stdio': {
      if (!config.command) throw new Error(`MCP server "${config.name}" has no command configured.`)
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) }
      })
    }
    case 'sse': {
      if (!config.url) throw new Error(`MCP server "${config.name}" has no URL configured.`)
      return new SSEClientTransport(new URL(config.url))
    }
    case 'http': {
      if (!config.url) throw new Error(`MCP server "${config.name}" has no URL configured.`)
      return new StreamableHTTPClientTransport(new URL(config.url))
    }
    case 'ws': {
      if (!config.url) throw new Error(`MCP server "${config.name}" has no URL configured.`)
      return new WebSocketClientTransport(new URL(config.url))
    }
    default:
      throw new Error(`Unknown MCP transport: ${String(config.transport)}`)
  }
}

export async function connectServer(id: string): Promise<McpStatus> {
  const config = readConfig().mcpServers.find((s) => s.id === id)
  if (!config) throw new Error(`No MCP server configured with id ${id}`)

  await disconnectServer(id)

  const client = new Client({ name: 'flashgent', version: '0.1.0' }, { capabilities: {} })
  try {
    await client.connect(buildTransport(config))
    const listed = await client.listTools()
    const tools: McpToolInfo[] = listed.tools.map((t) => ({
      server: config.id,
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema
    }))
    connections.set(id, { config, client, tools, error: null })
    logger.info(`MCP "${config.name}" connected with ${tools.length} tools`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`MCP "${config.name}" failed to connect`, message)
    try {
      await client.close()
    } catch {
      // Already dead — nothing to clean up.
    }
    broadcastStatus()
    throw new Error(message)
  }

  broadcastStatus()
  return statusOf(config)
}

export async function disconnectServer(id: string): Promise<boolean> {
  const live = connections.get(id)
  if (!live) return false
  connections.delete(id)
  try {
    await live.client.close()
  } catch {
    // Best effort — the transport may already be torn down.
  }
  broadcastStatus()
  return true
}

/** Bring up every server marked `enabled` in config, in parallel. */
export async function connectEnabledServers(): Promise<void> {
  const enabled = readConfig().mcpServers.filter((s) => s.enabled)
  await Promise.all(
    enabled.map((s) =>
      connectServer(s.id).catch(() => {
        // connectServer already logged; a failing server must not block others.
      })
    )
  )
}

export async function disconnectAll(): Promise<void> {
  await Promise.all([...connections.keys()].map((id) => disconnectServer(id)))
}

export function registerMcpHandlers(): void {
  handle<void, { statuses: McpStatus[]; tools: McpToolInfo[] }>(CH.mcpList, () => ({
    statuses: allStatuses(),
    tools: [...connections.values()].flatMap((c) => c.tools)
  }))

  handleN<McpStatus>(CH.mcpConnect, (id: string) => connectServer(id))
  handleN<boolean>(CH.mcpDisconnect, (id: string) => disconnectServer(id))

  handleN<{ content: string; isError: boolean }>(
    CH.mcpCall,
    async (server: string, tool: string, args: Record<string, unknown>) => {
      const live = connections.get(server)
      if (!live) throw new Error(`MCP server ${server} is not connected.`)

      const result = await live.client.callTool({ name: tool, arguments: args })
      const parts = Array.isArray(result.content) ? result.content : []
      const text = parts
        .map((part) => {
          const p = part as { type?: string; text?: string }
          if (p.type === 'text') return p.text ?? ''
          return `[${p.type ?? 'unknown'} content]`
        })
        .join('\n')

      return { content: text, isError: result.isError === true }
    }
  )
}

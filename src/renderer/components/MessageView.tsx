import type { AgentRole, ContentBlock, Message, ThinkingBlock } from '@shared/types'
import { useState } from 'react'
import { formatRelativeTime, formatTokens } from '../lib/format.js'
import { prefillProgress } from '../lib/prefill.js'
import { estimateTurnTokens } from '../lib/tokens.js'
import { useApp } from '../store/app.js'
import { Markdown } from './Markdown.js'
import { ToolBlockView } from './ToolBlock.js'

export interface AgentRoleConfig {
  role: AgentRole
  name: string
  tag: string
  constraint: string
  avatarClass: string
  badgeClass: string
}

export const AGENT_CONFIGS: Record<AgentRole, AgentRoleConfig> = {
  architect: {
    role: 'architect',
    name: 'Architect',
    tag: 'Architecture & Planning',
    constraint: 'Coordinates workflow, designs system structure, and formulates plans',
    avatarClass:
      'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400 border border-indigo-500/30',
    badgeClass: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25'
  },
  engineer: {
    role: 'engineer',
    name: 'Engineer',
    tag: 'Implementation & Execution',
    constraint: 'Implements code changes, executes tool subtasks, and performs edits',
    avatarClass:
      'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-500/30',
    badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
  }
}

export function resolveAgentRole(agent?: string | null, author?: string | null): AgentRole {
  const norm = (agent || author || '').toLowerCase().trim()
  if (norm === 'engineer') return 'engineer'
  return 'architect'
}

export function ArchitectIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={className ?? 'h-3.5 w-3.5'} fill="none" aria-hidden="true">
      <path
        d="M8 1.5L2 4.5l6 3 6-3-6-3zM2 8l6 3 6-3M2 11.5l6 3 6-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function EngineerIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className={className ?? 'h-3.5 w-3.5'} fill="none" aria-hidden="true">
      <path
        d="M5 5.5L2.5 8 5 10.5M11 5.5l2.5 2.5-2.5 2.5M9.5 3.5l-3 9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AgentHeader({
  role,
  model,
  isStreaming
}: {
  role: AgentRole
  model?: string | null
  isStreaming?: boolean
}): React.ReactElement {
  const config = AGENT_CONFIGS[role]

  return (
    <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-line/40 pb-2">
      <div className="flex items-center gap-2">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${config.avatarClass}`}
          title={`${config.name}: ${config.constraint}`}
        >
          {role === 'architect' ? (
            <ArchitectIcon className="h-3.5 w-3.5" />
          ) : (
            <EngineerIcon className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink">{config.name}</span>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium border ${config.badgeClass}`}
          >
            {config.tag}
          </span>
          <span className="hidden sm:inline text-[11px] text-faint" title={config.constraint}>
            {config.constraint}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {model && (
          <span className="truncate text-[11px] text-faint font-mono max-w-[200px]" title={model}>
            {model}
          </span>
        )}
        {isStreaming && (
          <span className="flex items-center gap-1 text-[11px] text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand fg-pulse" aria-hidden="true" />
            <span>Active</span>
          </span>
        )}
      </div>
    </div>
  )
}

function formatTokensPerSecond(tokens: number, durationMs: number | undefined): string | null {
  if (!durationMs || durationMs <= 0 || tokens <= 0) return null
  const speed = tokens / (durationMs / 1000)
  return `${speed >= 100 ? Math.round(speed) : speed.toFixed(1)} tok/s`
}
/** `1h 4m 9s` / `2m 14s` / `9s`, skipping the leading zero units. */
export function formatElapsed(ms: number): string {
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  const parts: string[] = []
  if (hours) parts.push(`${hours}h`)
  if (hours || minutes) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

/**
 * Reasoning readout:
 *
 *   Thinking · 4s              while the model reasons
 *   Thought for 4s             once it moves on
 *
 * No token count here on purpose: the only figure worth showing is the one for
 * the whole turn, and repeating it on every reasoning block made it look like
 * a per-block number that never changed. It lives in the turn footer instead.
 */
function ThinkingBlockView({ block }: { block: ThinkingBlock }): React.ReactElement {
  const [open, setOpen] = useState(false)

  const active = block.done !== true
  const parts: string[] = []

  if (active && block.durationMs) parts.push(formatElapsed(block.durationMs))
  if (active && block.nearingBudget) parts.push('almost done thinking')

  // Only `done` decides the tense. Keying off the duration left a block that
  // finished in under a second reading "Thinking" forever.
  const label = active
    ? 'Thinking'
    : block.durationMs
      ? `Thought for ${formatElapsed(block.durationMs)}`
      : 'Thought'

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-baseline gap-1.5 rounded-md px-1 py-0.5 text-[12px] text-faint hover:bg-raised/60 hover:text-muted"
      >
        <span aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`}>
          &rsaquo;
        </span>
        <span className={active ? 'fg-pulse text-muted' : ''}>{label}</span>
        {parts.map((part) => (
          <span key={part} className="text-faint">
            &middot; {part}
          </span>
        ))}
      </button>

      {open && (
        <div className="fg-unfold mt-1.5 ml-4 border-l border-line pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
          {block.text}
        </div>
      )}
    </div>
  )
}

export function BlockList({
  blocks,
  streaming
}: {
  blocks: ContentBlock[]
  streaming: boolean
}): React.ReactElement {
  return (
    <>
      {blocks.map((block, index) => {
        const key = block.type === 'tool_use' ? block.id : `${block.type}-${index}`
        if (block.type === 'text') {
          return block.text.trim() ? (
            <Markdown key={key} content={block.text} streaming={streaming} />
          ) : null
        }
        if (block.type === 'thinking') {
          return <ThinkingBlockView key={key} block={block} />
        }
        return <ToolBlockView key={key} block={block} />
      })}
    </>
  )
}

/**
 * The turn's live footer: elapsed time, tokens, and what it is busy with.
 *
 *   ✳ 2m 14s · 82.3k tokens · 1 running task
 */
export function TurnStatus({ startedAt }: { startedAt: number }): React.ReactElement | null {
  const streaming = useApp((s) => s.streaming)
  const liveBlocks = useApp((s) => s.liveBlocks)
  const backgroundTasks = useApp((s) => s.backgroundTasks)
  const currentAction = useApp((s) => s.currentAction)
  const prefill = useApp((s) => s.prefill)
  const tick = useApp((s) => s.tick)

  if (!streaming) return null

  // `tick` only exists to re-render this line once a second.
  void tick

  // Nothing has come back yet, so the server is still reading the prompt. On
  // modest hardware that is most of the wait, and a ticking clock with no
  // tokens next to it reads as a hang — name what is actually happening, with
  // a percentage once this machine's prefill speed has been measured.
  if (prefill && liveBlocks.length === 0) {
    const { percent } = prefillProgress(
      prefill.model,
      prefill.promptTokens,
      Date.now() - prefill.startedAt
    )

    // Past the estimate the percentage is a guess that has already been wrong,
    // and a bar frozen at 99% reads as a hang. Say "still going" instead.
    const overrun = percent !== null && percent >= 99

    return (
      <div className="mt-2 flex items-center gap-2 text-[12px] text-faint">
        <span className="fg-pulse text-brand" aria-hidden>
          &#10035;
        </span>
        <span>
          prompt processing{percent === null || overrun ? '' : ` — ${percent}%`}
          &hellip;
        </span>

        {percent !== null &&
          (overrun ? (
            <span className="relative h-1 w-24 overflow-hidden rounded-full bg-line fg-sweep" />
          ) : (
            <span className="h-1 w-24 overflow-hidden rounded-full bg-line">
              <span className="fg-meter block h-full bg-brand" style={{ width: `${percent}%` }} />
            </span>
          ))}
      </div>
    )
  }

  const running = liveBlocks.filter(
    (b) => b.type === 'tool_use' && (b.status === 'running' || b.status === 'pending')
  ).length
  const thinking = liveBlocks.some((b) => b.type === 'thinking' && b.done !== true)

  const activity =
    running > 0
      ? `${running} running task${running === 1 ? '' : 's'}`
      : backgroundTasks > 0
        ? `${backgroundTasks} background task${backgroundTasks === 1 ? '' : 's'}`
        : thinking
          ? 'thinking'
          : (currentAction?.toLowerCase() ?? 'writing')

  const parts = [
    formatElapsed(Date.now() - startedAt),
    `${formatTokens(estimateTurnTokens(liveBlocks))} tokens`,
    activity
  ]

  return (
    <div className="mt-2 flex items-baseline gap-2 text-[12px] text-faint">
      <span className="fg-pulse text-brand" aria-hidden>
        &#10035;
      </span>
      <span>{parts.join(' · ')}</span>
    </div>
  )
}

interface MessageViewProps {
  message: Message
  isLast: boolean
}

/** Small icon button used for the per-message actions. */
function Action({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1 text-faint hover:bg-raised hover:text-muted disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function MessageView({ message, isLast }: MessageViewProps): React.ReactElement {
  const streaming = useApp((s) => s.streaming)
  const rewindTo = useApp((s) => s.rewindTo)
  const rollbackTurn = useApp((s) => s.rollbackTurn)
  const forkFrom = useApp((s) => s.forkFrom)
  const retryLast = useApp((s) => s.retryLast)
  const toast = useApp((s) => s.toast)

  const copyMessage = async (): Promise<void> => {
    const text = message.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n\n')
    await navigator.clipboard.writeText(text)
    toast('success', 'Copied')
  }

  const isUser = message.role === 'user'
  const userText = message.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n\n')

  const isCompactionNotice =
    isUser && (userText.includes('Compaction finished') || userText.includes('[Compacted history]'))

  if (isCompactionNotice) {
    return (
      <article className="fg-enter group px-6 py-3">
        <div className="mx-auto fg-column">
          <div className="rounded-xl border border-brand/40 bg-brand/5 p-4 shadow-sm backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-brand/20 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/20 text-brand">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                    <path
                      d="M9 1.5L3.5 9h4l-1 5.5L13 7H8.5l1-5.5z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="font-semibold text-ink text-sm">Context Compaction</span>
              </div>
              <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-medium text-brand border border-brand/30">
                History Preserved
              </span>
            </div>
            <div className="fg-transcript text-sm leading-relaxed text-muted">
              <Markdown content={userText} streaming={false} />
            </div>
          </div>
        </div>
      </article>
    )
  }

  // The user's own words read as a message; the agent's output reads as a
  // document, so only the former gets a bubble.
  if (isUser) {
    return (
      <article className="fg-enter group px-6 py-3">
        <div className="mx-auto fg-column">
          <div className="flex justify-end">
            <div className="fg-transcript max-w-[85%] rounded-2xl bg-raised px-4 py-2.5 leading-[1.65] whitespace-pre-wrap text-ink">
              {message.blocks
                .filter((b) => b.type === 'text')
                .map((b) => (b as { text: string }).text)
                .join('\n\n')}
            </div>
          </div>

          <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Action label="Copy" onClick={() => void copyMessage()}>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" />
                <path d="M10.5 3.5h-7a1 1 0 0 0-1 1v7" stroke="currentColor" />
              </svg>
            </Action>
            <Action
              label="Rewind to here"
              disabled={streaming}
              onClick={() => void rewindTo(message.id)}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                <path
                  d="M3 8a5 5 0 1 0 1.6-3.7M3 3v3h3"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Action>
            <Action
              label="Rollback files & chat to here"
              disabled={streaming}
              onClick={() => void rollbackTurn(message.id)}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                <path
                  d="M2 8a6 6 0 1 1 1.8 4.2M2 3v5h5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              </svg>
            </Action>
            <Action
              label="Fork from here"
              disabled={streaming}
              onClick={() => void forkFrom(message.id)}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" />
                <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" />
                <circle cx="11.5" cy="3.5" r="1.6" stroke="currentColor" />
                <path d="M4.5 5.1v5.8M11.5 5.1v1.4a3 3 0 0 1-3 3H6" stroke="currentColor" />
              </svg>
            </Action>
            <span className="ml-1 text-[11px] text-faint">
              {formatRelativeTime(message.createdAt)}
            </span>
          </div>
        </div>
      </article>
    )
  }

  const agentRole = resolveAgentRole(message.agent, message.author)

  return (
    <article className="fg-enter group px-6 pb-3">
      <div className="mx-auto fg-column">
        <AgentHeader role={agentRole} model={message.model} />
        <div className="fg-transcript">
          <BlockList blocks={message.blocks} streaming={false} />
        </div>

        <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Action label="Copy" onClick={() => void copyMessage()}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" />
              <path d="M10.5 3.5h-7a1 1 0 0 0-1 1v7" stroke="currentColor" />
            </svg>
          </Action>
          {isLast && (
            <Action label="Regenerate" disabled={streaming} onClick={() => void retryLast()}>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
                <path
                  d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Action>
          )}
          <Action
            label="Fork from here"
            disabled={streaming}
            onClick={() => void forkFrom(message.id)}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
              <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" />
              <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" />
              <circle cx="11.5" cy="3.5" r="1.6" stroke="currentColor" />
              <path d="M4.5 5.1v5.8M11.5 5.1v1.4a3 3 0 0 1-3 3H6" stroke="currentColor" />
            </svg>
          </Action>

          <span className="ml-1 text-[11px] text-faint">
            {formatRelativeTime(message.createdAt)}
          </span>
          {message.usage &&
            (() => {
              const tokens = estimateTurnTokens(message.blocks)
              const speed = formatTokensPerSecond(tokens, message.generationMs)
              return (
                <span className="ml-auto text-[11px] tabular-nums text-faint">
                  {formatTokens(tokens)} tokens{speed ? ` · ${speed}` : ''}
                </span>
              )
            })()}
        </div>
      </div>
    </article>
  )
}

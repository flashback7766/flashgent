import type { ToolUseBlock } from '@shared/types'
import { useState } from 'react'
import { formatDuration } from '../lib/format.js'
import { useApp } from '../store/app.js'
import { Markdown } from './Markdown.js'

const STATUS_DOT: Record<ToolUseBlock['status'], string> = {
  pending: 'bg-faint',
  'awaiting-permission': 'bg-warn',
  running: 'bg-brand fg-pulse',
  ok: 'bg-ok',
  error: 'bg-bad',
  denied: 'bg-faint'
}

/** A short, human phrase for what the call is doing. */
function summarise(block: ToolUseBlock): string {
  const input = block.input
  const str = (key: string): string => (typeof input[key] === 'string' ? (input[key] as string) : '')

  switch (block.name) {
    case 'read_file':
      return str('path')
    case 'write_file':
      return str('path')
    case 'edit_file':
      return str('path')
    case 'glob':
    case 'grep':
      return str('pattern')
    case 'list_dir':
      return str('path') || '.'
    case 'run_shell':
      return str('command')
    case 'shell_output':
      return str('task_id')
    case 'web_fetch':
      return str('url')
    case 'web_search':
      return str('query')
    case 'run_subtask':
      return str('description')
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string')
      return typeof first === 'string' ? first : ''
    }
  }
}

function ResultBody({ block }: { block: ToolUseBlock }): React.ReactElement {
  const result = block.result
  if (!result) return <p className="py-2 text-[12px] text-faint">No result yet.</p>

  const kind = result.display?.kind ?? 'plain'
  const language = kind === 'diff' ? 'diff' : (result.display?.language ?? '')

  if (kind === 'diff' || kind === 'shell' || kind === 'file') {
    return <Markdown content={'```' + language + '\n' + result.content + '\n```'} />
  }

  return (
    <pre className="max-h-80 overflow-auto py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-muted">
      {result.content}
    </pre>
  )
}

/**
 * One line per call, the way a terminal log reads. Everything else — the
 * arguments, the output, the diff — is behind the chevron.
 */
export function ToolBlockView({ block }: { block: ToolUseBlock }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const summary = summarise(block)
  const flagged = block.result?.flagged ?? []

  return (
    <div className="fg-enter my-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group/tool flex w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left hover:bg-raised/60"
      >
        <span
          aria-hidden
          className={`shrink-0 text-[11px] text-faint transition-transform ${open ? 'rotate-90' : ''}`}
        >
          &rsaquo;
        </span>
        <span
          className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${STATUS_DOT[block.status]}`}
          aria-hidden
        />
        <span className="shrink-0 font-mono text-[12.5px] text-muted">{block.name}</span>
        {summary && (
          <span className="truncate font-mono text-[12.5px] text-faint" title={summary}>
            {summary}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-faint">
          {flagged.length > 0 && (
            <span
              className="rounded border border-bad/50 px-1.5 py-px text-[10px] font-medium text-bad"
              title={`Text in this output tried to instruct the agent and was ignored: ${flagged
                .map((f) => f.label)
                .join(', ')}`}
            >
              injection blocked
            </span>
          )}
          {block.status === 'denied' && <span className="text-faint">denied</span>}
          {block.status === 'error' && <span className="text-bad">failed</span>}
          {block.durationMs !== undefined && block.status === 'ok' && (
            <span className="opacity-0 transition-opacity group-hover/tool:opacity-100">
              {formatDuration(block.durationMs)}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="fg-unfold ml-4 border-l border-line pl-3">
          <span className="text-[10.5px] uppercase tracking-wide text-faint">Arguments</span>
          <pre className="mt-1 overflow-x-auto rounded bg-raised p-2 font-mono text-[11.5px] text-muted">
            {JSON.stringify(block.input, null, 2)}
          </pre>
          <span className="mt-2 block text-[10.5px] uppercase tracking-wide text-faint">
            Result
          </span>
          <ResultBody block={block} />

          {(block.name === 'write_file' || block.name === 'edit_file') && block.status === 'ok' && (
            <div className="mt-2 pt-2 border-t border-line/60 flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  const path = typeof block.input.path === 'string' ? block.input.path : ''
                  if (!path) return
                  const session = useApp.getState().sessions.find((s) => s.id === useApp.getState().activeSessionId)
                  if (!session) return
                  const snapshots = await window.flashgent.fs.listSnapshots(session.id)
                  if (snapshots.ok && snapshots.value.length > 0) {
                    const match = snapshots.value.reverse().find((s) => s.path.endsWith(path))
                    if (match) {
                      await useApp.getState().revertSnapshot(match.id)
                      return
                    }
                  }
                  useApp.getState().toast('error', 'No snapshot available for this file')
                }}
                className="rounded border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-muted hover:border-brand hover:text-brand transition-colors"
              >
                ↩ Revert file change
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

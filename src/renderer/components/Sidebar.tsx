import type { Session } from '@shared/types'
import { useMemo, useState } from 'react'
import { formatRelativeTime } from '../lib/format.js'
import { useApp } from '../store/app.js'

/** Last path segment, which is what a project is actually called. */
function workspaceName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

interface Group {
  key: string
  name: string
  cwd: string
  sessions: Session[]
}

function ConnectionDot({ state }: { state: string }): React.ReactElement {
  const colour =
    state === 'ok'
      ? 'bg-ok'
      : state === 'checking'
        ? 'bg-warn fg-pulse'
        : state === 'error'
          ? 'bg-bad'
          : 'bg-faint'
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colour}`} aria-hidden />
}

function SessionRow({ session }: { session: Session }): React.ReactElement {
  const activeSessionId = useApp((s) => s.activeSessionId)
  const selectSession = useApp((s) => s.selectSession)
  const deleteSession = useApp((s) => s.deleteSession)
  const toggleStar = useApp((s) => s.toggleStar)
  const renameSession = useApp((s) => s.renameSession)

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(session.title)

  const active = session.id === activeSessionId

  const commit = async (): Promise<void> => {
    const title = draft.trim()
    if (title && title !== session.title) await renameSession(session.id, title)
    setRenaming(false)
  }

  if (renaming) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') setRenaming(false)
        }}
        className="my-px w-full rounded-md border border-brand bg-canvas px-2 py-1 text-[12.5px] outline-none"
      />
    )
  }

  return (
    <div
      className={`group/row my-px flex items-center gap-1.5 rounded-md px-2 py-1 ${
        active ? 'bg-raised' : 'hover:bg-raised/60'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          active ? 'bg-brand' : 'bg-transparent ring-1 ring-line'
        }`}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => void selectSession(session.id)}
        onDoubleClick={() => {
          setDraft(session.title)
          setRenaming(true)
        }}
        title={`${session.title}\n${formatRelativeTime(session.updatedAt)}`}
        className={`min-w-0 flex-1 truncate text-left text-[12.5px] ${
          active ? 'text-ink' : 'text-muted'
        }`}
      >
        {session.title}
      </button>

      <button
        type="button"
        onClick={() => void toggleStar(session.id)}
        aria-label={session.starred ? 'Unstar session' : 'Star session'}
        className={`shrink-0 text-[11px] ${
          session.starred ? 'text-brand' : 'text-faint opacity-0 group-hover/row:opacity-100'
        }`}
      >
        ★
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete "${session.title}"? This cannot be undone.`)) {
            void deleteSession(session.id)
          }
        }}
        aria-label={`Delete ${session.title}`}
        className="shrink-0 text-[13px] leading-none text-faint opacity-0 hover:text-bad group-hover/row:opacity-100"
      >
        &times;
      </button>
    </div>
  )
}

export function Sidebar(): React.ReactElement {
  const sessions = useApp((s) => s.sessions)
  const newSession = useApp((s) => s.newSession)
  const chooseWorkspace = useApp((s) => s.chooseWorkspace)
  const searchQuery = useApp((s) => s.searchQuery)
  const setSearchQuery = useApp((s) => s.setSearchQuery)
  const activeSessionId = useApp((s) => s.activeSessionId)

  const connection = useApp((s) => s.connection)
  const connectionError = useApp((s) => s.connectionError)
  const refreshModels = useApp((s) => s.refreshModels)
  const models = useApp((s) => s.models)
  const mcpStatuses = useApp((s) => s.mcpStatuses)
  const mcpTools = useApp((s) => s.mcpTools)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const info = useApp((s) => s.info)

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const { starred, groups } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const visible = query
      ? sessions.filter((s) => s.title.toLowerCase().includes(query))
      : sessions

    const byWorkspace = new Map<string, Group>()
    for (const session of visible) {
      const key = session.cwd.toLowerCase()
      const group = byWorkspace.get(key)
      if (group) group.sessions.push(session)
      else {
        byWorkspace.set(key, {
          key,
          name: workspaceName(session.cwd),
          cwd: session.cwd,
          sessions: [session]
        })
      }
    }

    // Most recently touched project first; the active one always on top.
    const ordered = [...byWorkspace.values()].sort((a, b) => {
      if (activeSession) {
        const aActive = a.key === activeSession.cwd.toLowerCase()
        const bActive = b.key === activeSession.cwd.toLowerCase()
        if (aActive !== bActive) return aActive ? -1 : 1
      }
      const aLatest = Math.max(...a.sessions.map((s) => s.updatedAt))
      const bLatest = Math.max(...b.sessions.map((s) => s.updatedAt))
      return bLatest - aLatest
    })

    return { starred: visible.filter((s) => s.starred), groups: ordered }
  }, [sessions, searchQuery, activeSession])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="px-2 pt-3 pb-2">
        <button
          type="button"
          onClick={() => void newSession(activeSession?.cwd)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-raised hover:text-ink"
        >
          <span className="text-[14px] leading-none text-faint">+</span>
          New chat
        </button>
        <button
          type="button"
          onClick={() => void chooseWorkspace()}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-raised hover:text-ink"
        >
          <span className="text-[13px] leading-none text-faint">⌘</span>
          Open folder
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-raised hover:text-ink"
        >
          <span className="text-[13px] leading-none text-faint">⚙</span>
          Settings
        </button>

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sessions..."
          aria-label="Search sessions"
          className="mt-2 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-faint focus:border-brand"
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Sessions">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-[12px] text-faint">No sessions match.</p>
        )}

        {starred.length > 0 && (
          <section className="mb-1">
            <h2 className="px-2 pt-3 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-faint">
              Starred
            </h2>
            {starred.map((session) => (
              <SessionRow key={`starred-${session.id}`} session={session} />
            ))}
          </section>
        )}

        {groups.map((group) => (
          <section key={group.key}>
            <div className="group/head flex items-center gap-1 px-2 pt-3 pb-1">
              <h2
                className="min-w-0 flex-1 truncate text-[10.5px] font-medium uppercase tracking-wider text-faint"
                title={group.cwd}
              >
                {group.name}
              </h2>
              <button
                type="button"
                onClick={() => void newSession(group.cwd)}
                aria-label={`New chat in ${group.name}`}
                title={`New chat in ${group.name}`}
                className="shrink-0 px-1 text-[13px] leading-none text-faint opacity-0 hover:text-ink group-hover/head:opacity-100"
              >
                +
              </button>
            </div>
            {group.sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </section>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-2.5 text-[11.5px]">
        <button
          type="button"
          onClick={() => void refreshModels()}
          className="flex w-full items-center gap-1.5 text-left"
          title={connectionError ?? 'Reconnect to LM Studio'}
        >
          <ConnectionDot state={connection} />
          <span className="truncate text-muted">
            {connection === 'ok'
              ? `${models.length} model${models.length === 1 ? '' : 's'}`
              : connection === 'checking'
                ? 'connecting...'
                : 'LM Studio offline'}
          </span>
          {mcpStatuses.length > 0 && (
            <span className="ml-auto shrink-0 text-faint" title="MCP tools">
              {mcpTools.length} MCP
            </span>
          )}
        </button>

        {connection === 'error' && connectionError && (
          <p className="mt-1 line-clamp-3 text-[11px] text-bad">{connectionError}</p>
        )}

        {/* Context lives on the ring in the status bar, with a full breakdown
            behind it — a second, less useful copy here was just noise. */}

        <div className="mt-2 flex items-center gap-1.5 text-faint">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-brand text-[9px] font-semibold text-white">
            f
          </span>
          <span>flashgent {info?.version ?? ''}</span>
        </div>
      </div>
    </aside>
  )
}

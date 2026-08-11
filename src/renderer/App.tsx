import { useEffect } from 'react'
import { ChatView } from './components/ChatView.js'
import { Composer } from './components/Composer.js'
import { Settings } from './components/Settings.js'
import { Sidebar } from './components/Sidebar.js'
import { Toasts } from './components/Toasts.js'
import { useApp } from './store/app.js'

function Splash(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-xl font-semibold text-white">
        f
      </div>
      <span className="text-[12.5px] text-faint fg-pulse">starting flashgent…</span>
    </div>
  )
}

/** Session tabs, shown once more than one session is open. */
function TabBar(): React.ReactElement | null {
  const openTabs = useApp((s) => s.openTabs)
  const sessions = useApp((s) => s.sessions)
  const activeSessionId = useApp((s) => s.activeSessionId)
  const selectSession = useApp((s) => s.selectSession)
  const closeTab = useApp((s) => s.closeTab)

  const tabs = openTabs
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  if (tabs.length < 2) return null

  return (
    <div className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-line bg-surface">
      {tabs.map((session) => {
        const active = session.id === activeSessionId
        return (
          <div
            key={session.id}
            className={`group flex max-w-52 shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 ${
              active ? 'border-brand bg-canvas' : 'border-transparent hover:bg-raised/60'
            }`}
          >
            <button
              type="button"
              onClick={() => void selectSession(session.id)}
              className={`truncate text-[12px] ${active ? 'text-ink' : 'text-muted'}`}
            >
              {session.title}
            </button>
            <button
              type="button"
              onClick={() => closeTab(session.id)}
              aria-label={`Close ${session.title}`}
              className="shrink-0 text-[13px] text-faint opacity-0 hover:text-ink group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function App(): React.ReactElement {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const toast = useApp((s) => s.toast)
  const sessions = useApp((s) => s.sessions)
  const activeSessionId = useApp((s) => s.activeSessionId)

  useEffect(() => {
    init().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      window.flashgent.app.log('error', `init failed: ${message}`)
      toast('error', `Startup failed: ${message}`)
    })
    // Run once on mount: the store is a singleton and init is idempotent.
  }, [])

  // The OS window title tracks the active session.
  useEffect(() => {
    const session = sessions.find((s) => s.id === activeSessionId)
    document.title = session ? `flashgent — ${session.title}` : 'flashgent'
  }, [sessions, activeSessionId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const store = useApp.getState()
      const mod = event.ctrlKey || event.metaKey

      if (event.key === 'Escape') {
        if (store.settingsOpen) store.setSettingsOpen(false)
        else if (store.streaming) store.stop()
        return
      }

      // Shift+Tab cycles the permission mode, the way Claude Code does.
      if (event.key === 'Tab' && event.shiftKey && !mod) {
        event.preventDefault()
        void store.cyclePermissionMode(1)
        return
      }

      if (!mod) return

      if (event.key === 't') {
        event.preventDefault()
        void store.newSession(store.sessions.find((s) => s.id === store.activeSessionId)?.cwd)
      } else if (event.key === ',') {
        event.preventDefault()
        store.setSettingsOpen(!store.settingsOpen)
      } else if (event.key === 'l') {
        event.preventDefault()
        window.dispatchEvent(new Event('fg:focus-input'))
      } else if (event.key === 'k') {
        event.preventDefault()
        const first = store.messages[0]
        if (first) void store.rewindTo(first.id)
      } else if (/^[1-9]$/.test(event.key)) {
        // Ctrl+N jumps to the Nth session in the sidebar order.
        const target = store.sessions[Number(event.key) - 1]
        if (target) {
          event.preventDefault()
          void store.selectSession(target.id)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!ready) return <Splash />

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <ChatView />
        <Composer />
      </main>
      <Settings />
      <Toasts />
    </div>
  )
}

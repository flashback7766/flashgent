import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { shortPath } from '../lib/format.js'
import { useApp } from '../store/app.js'
import { ContextRing, EffortControl, ModelPicker, ModeSwitcher } from './StatusBar.js'

const SLASH_COMMANDS = [
  { name: '/clear', description: 'Rewind the conversation to empty' },
  { name: '/compact', description: 'Summarise the history to free context' },
  { name: '/export', description: 'Export this chat as Markdown' },
  { name: '/cwd', description: 'Change the workspace directory' },
  { name: '/help', description: 'Show what flashgent can do' }
]

export function Composer(): React.ReactElement {
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionHits, setMentionHits] = useState<string[]>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const streaming = useApp((s) => s.streaming)
  const send = useApp((s) => s.send)
  const stop = useApp((s) => s.stop)
  const attachments = useApp((s) => s.attachments)
  const attachFiles = useApp((s) => s.attachFiles)
  const removeAttachment = useApp((s) => s.removeAttachment)
  const sessions = useApp((s) => s.sessions)
  const activeSessionId = useApp((s) => s.activeSessionId)
  const connection = useApp((s) => s.connection)
  const messages = useApp((s) => s.messages)

  const session = sessions.find((s) => s.id === activeSessionId)

  // Auto-grow up to ten rows, then scroll inside the box.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 22
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * 10)}px`
  }, [text])

  useEffect(() => {
    const focus = (): void => textareaRef.current?.focus()
    focus()
    window.addEventListener('fg:focus-input', focus)
    return () => window.removeEventListener('fg:focus-input', focus)
  }, [])

  const slashHits = text.startsWith('/')
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(text.split(' ')[0] ?? ''))
    : []

  const runSlash = async (command: string): Promise<boolean> => {
    const store = useApp.getState()
    switch (command) {
      case '/clear': {
        const first = messages[0]
        if (first) await store.rewindTo(first.id)
        return true
      }
      case '/compact':
        await store.compact()
        return true
      case '/export':
        await store.exportSession('md')
        return true
      case '/cwd':
        await store.chooseWorkspace()
        return true
      case '/help':
        store.toast(
          'info',
          'Ctrl+Enter send | Esc stop | Ctrl+T new chat | Shift+Tab mode | Ctrl+, settings | @ to attach'
        )
        return true
      default:
        return false
    }
  }

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || streaming) return

    if (value.startsWith('/')) {
      const handled = await runSlash(value.split(' ')[0] ?? '')
      if (handled) {
        setText('')
        return
      }
    }
    setText('')
    setMentionQuery(null)
    await send(value)
  }

  // `@` starts a file lookup against the workspace.
  const updateMentions = async (value: string): Promise<void> => {
    const match = /@([\w./\-\\]*)$/.exec(value)
    if (!match || !session) {
      setMentionQuery(null)
      setMentionHits([])
      return
    }
    const query = match[1] ?? ''
    setMentionQuery(query)
    const result = await window.flashgent.fs.glob({
      pattern: query ? `**/*${query}*` : '**/*',
      cwd: session.cwd,
      limit: 8
    })
    setMentionHits(result.ok ? result.value : [])
  }

  const applyMention = (path: string): void => {
    setText((current) => current.replace(/@([\w./\-\\]*)$/, `@${path} `))
    setMentionQuery(null)
    textareaRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && mentionQuery !== null && mentionHits[0]) {
      event.preventDefault()
      applyMention(mentionHits[0])
      return
    }
    if (event.key === 'Escape' && mentionQuery !== null) {
      event.preventDefault()
      setMentionQuery(null)
    }
  }

  const attachViaDialog = async (): Promise<void> => {
    if (!session) return
    const picked = await window.flashgent.fs.pickFiles(session.cwd)
    if (picked.ok && picked.value.length) await attachFiles(picked.value)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    const paths = [...event.dataTransfer.files]
      .map((file) => {
        try {
          return window.flashgent.app.pathForFile(file)
        } catch {
          return ''
        }
      })
      .filter((p) => p.length > 0)
    if (paths.length) void attachFiles(paths)
  }

  return (
    <div
      className={`bg-canvas px-6 pb-4 pt-2 ${dragging ? 'bg-brand-soft' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="mx-auto fg-column">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((file) => (
              <span
                key={file.path}
                className="flex items-center gap-1.5 rounded border border-line bg-surface px-2 py-1 font-mono text-[11px] text-muted"
              >
                {shortPath(file.path)}
                {file.truncated && <span className="text-warn">trimmed</span>}
                <button
                  type="button"
                  onClick={() => removeAttachment(file.path)}
                  className="text-faint hover:text-bad"
                  aria-label={`Remove ${file.path}`}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Controls sit above the box as bare chips, with no frame of their own. */}
        <div className="mb-1.5 flex items-center gap-1">
          <ModeSwitcher />

          <button
            type="button"
            onClick={() => void attachViaDialog()}
            aria-label="Attach a file"
            title="Attach a file from the workspace"
            className="rounded-md px-1.5 py-1 text-[15px] leading-none text-faint hover:bg-raised hover:text-ink"
          >
            +
          </button>

          <span className="truncate text-[11px] text-faint" title={session?.cwd}>
            {session ? shortPath(session.cwd) : ''}
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <ModelPicker />
            <EffortControl />
            <ContextRing />
          </div>
        </div>

        <div className="relative rounded-xl border border-line bg-surface focus-within:border-brand">
          {mentionQuery !== null && mentionHits.length > 0 && (
            <ul className="absolute bottom-full left-0 mb-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
              {mentionHits.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => applyMention(path)}
                    className="block w-full px-3 py-1.5 text-left font-mono text-[12px] text-muted hover:bg-raised hover:text-ink"
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {slashHits.length > 0 && (
            <ul className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
              {slashHits.map((command) => (
                <li key={command.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setText(command.name)
                      textareaRef.current?.focus()
                    }}
                    className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-raised"
                  >
                    <span className="font-mono text-[12px] text-brand">{command.name}</span>
                    <span className="text-[11.5px] text-faint">{command.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              void updateMentions(e.target.value)
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              connection === 'ok'
                ? 'Ask flashgent to build, explain, or fix something...'
                : 'Connect to LM Studio to get started...'
            }
            aria-label="Message"
            className="max-h-56 w-full resize-none bg-transparent py-3 pl-3.5 pr-11 text-[14px] leading-[1.55] text-ink outline-none placeholder:text-faint"
          />

          {/* Send lives inside the box, as an icon in the bottom-right corner. */}
          <div className="absolute bottom-2 right-2">
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop"
                title="Stop (Esc)"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-bad text-white hover:opacity-90"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                  <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!text.trim()}
                aria-label="Send"
                title="Send (Ctrl+Enter)"
                className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
                  <path
                    d="M13 3.5V7A2.5 2.5 0 0 1 10.5 9.5H4m0 0 3-3m-3 3 3 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

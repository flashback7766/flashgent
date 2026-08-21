import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../store/app.js'
import { AgentHeader, BlockList, MessageView, TurnStatus } from './MessageView.js'
import { ContinueCard, PermissionCard } from './PermissionCard.js'
import { QuestionCard } from './QuestionCard.js'

/** How close to the bottom still counts as "following" the stream. */
const STICK_THRESHOLD_PX = 80

function EmptyState(): React.ReactElement {
  const connection = useApp((s) => s.connection)
  const chooseWorkspace = useApp((s) => s.chooseWorkspace)
  const session = useApp((s) => s.sessions.find((x) => x.id === s.activeSessionId))

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-lg font-semibold text-white">
        f
      </div>
      <h1 className="mt-4 text-[15px] font-medium text-ink">flashgent</h1>
      <p className="mt-1 max-w-md text-[13px] text-muted">
        A local coding agent. It reads and edits files, runs commands, and never leaves your
        machine.
      </p>

      {connection !== 'ok' && (
        <p className="mt-4 max-w-md rounded-lg border border-warn/40 bg-warn/8 px-3 py-2 text-[12.5px] text-muted">
          LM Studio is not reachable yet. Open it, go to <b>Developer &rarr; Start Server</b>, load
          a model, then click the status dot in the sidebar.
        </p>
      )}

      <button
        type="button"
        onClick={() => void chooseWorkspace()}
        className="mt-4 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted hover:bg-raised hover:text-ink"
      >
        Workspace: {session?.cwd ?? '—'}
      </button>
    </div>
  )
}

/**
 * Offered once a plan-mode turn has finished: approving it switches out of
 * plan mode and asks the agent to carry the plan out.
 */
function PlanApproval(): React.ReactElement | null {
  const streaming = useApp((s) => s.streaming)
  const messages = useApp((s) => s.messages)
  const approvePlan = useApp((s) => s.approvePlan)
  const setPermissionMode = useApp((s) => s.setPermissionMode)
  const mode = useApp((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.permissionMode)

  const last = messages[messages.length - 1]
  if (mode !== 'plan' || streaming || last?.role !== 'assistant') return null

  return (
    <div className="fg-enter px-6 py-3">
      <div className="mx-auto flex fg-column items-center gap-3 rounded-lg border border-brand/40 bg-brand-soft/40 p-3">
        <p className="flex-1 text-[12.5px] text-muted">
          Plan mode is on, so nothing has been changed yet.
        </p>
        <button
          type="button"
          onClick={() => void approvePlan()}
          className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
        >
          Approve and run
        </button>
        <button
          type="button"
          onClick={() => void setPermissionMode('manual')}
          className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
        >
          Leave plan mode
        </button>
      </div>
    </div>
  )
}

export function ChatView(): React.ReactElement {
  const messages = useApp((s) => s.messages)
  const liveBlocks = useApp((s) => s.liveBlocks)
  const streaming = useApp((s) => s.streaming)
  const turnStartedAt = useApp((s) => s.turnStartedAt)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(true)

  // Follow the stream only while the user is already parked at the bottom.
  useLayoutEffect(() => {
    if (!stuck) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, liveBlocks, stuck])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setStuck(distance < STICK_THRESHOLD_PX)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const empty = messages.length === 0 && !streaming

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        {empty ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((message, index) => (
              <MessageView
                key={message.id}
                message={message}
                isLast={index === messages.length - 1}
              />
            ))}

            {streaming && (
              <article className="px-6 pb-3">
                <div className="mx-auto fg-column">
                  <AgentHeader role="architect" isStreaming />
                  <div className="fg-transcript">
                    <BlockList blocks={liveBlocks} streaming />
                  </div>
                  <TurnStatus startedAt={turnStartedAt} />
                </div>
              </article>
            )}

            <PermissionCard />
            <QuestionCard />
            <ContinueCard />
            <PlanApproval />
            <div className="h-4" />
          </>
        )}
      </div>

      {!stuck && (
        <button
          type="button"
          onClick={() => {
            const el = scrollRef.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
            setStuck(true)
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-muted shadow-lg hover:text-ink"
        >
          Jump to latest &darr;
        </button>
      )}
    </div>
  )
}

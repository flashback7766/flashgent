import { useEffect, useRef } from 'react'
import { useApp } from '../store/app.js'

/**
 * Inline gate shown when the agent wants to run something that mutates state.
 * "Always" writes a rule into config so the same call stops asking.
 */
export function PermissionCard(): React.ReactElement | null {
  const request = useApp((s) => s.pendingPermission)
  const resolve = useApp((s) => s.resolvePermission)
  const allowRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (request) allowRef.current?.focus()
  }, [request])

  if (!request) return null

  const { definition, input } = request
  const command = typeof input.command === 'string' ? input.command : null
  const path = typeof input.path === 'string' ? input.path : null

  return (
    <div className="fg-enter px-6 py-3">
      <div
        className="mx-auto fg-column rounded-lg border border-warn/50 bg-warn/8 p-3"
        role="alertdialog"
        aria-label="Permission required"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12.5px] font-medium text-ink">{definition.name}</span>
          <span className="text-[11px] uppercase tracking-wide text-warn">
            {definition.risk === 'execute' ? 'executes a command' : 'modifies files'}
          </span>
        </div>

        {(command ?? path) && (
          <pre className="mt-2 overflow-x-auto rounded bg-raised px-2.5 py-2 font-mono text-[12px] text-ink">
            {command ?? path}
          </pre>
        )}

        {!command && !path && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-raised px-2.5 py-2 font-mono text-[11.5px] text-muted">
            {JSON.stringify(input, null, 2)}
          </pre>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            ref={allowRef}
            type="button"
            onClick={() => resolve('allow')}
            className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => resolve('always-allow')}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
          >
            Always allow
          </button>
          <button
            type="button"
            onClick={() => resolve('deny')}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => resolve('always-deny')}
            className="text-[11.5px] text-faint hover:text-bad"
          >
            Never allow
          </button>
        </div>
      </div>
    </div>
  )
}

/** Shown when the loop hits the iteration cap and needs a nudge to continue. */
export function ContinueCard(): React.ReactElement | null {
  const iterations = useApp((s) => s.pendingContinue)
  const resolve = useApp((s) => s.resolveContinue)

  if (iterations === null) return null

  return (
    <div className="fg-enter px-6 py-3">
      <div className="mx-auto flex fg-column items-center gap-3 rounded-lg border border-line bg-surface p-3">
        <p className="flex-1 text-[12.5px] text-muted">
          flashgent has run {iterations} steps without finishing. Keep going?
        </p>
        <button
          type="button"
          onClick={() => resolve(true)}
          className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => resolve(false)}
          className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
        >
          Finish now
        </button>
      </div>
    </div>
  )
}

import { EFFORT_ORDER, type EffortLevel, type PermissionMode } from '@shared/types'
import { Fragment, useState } from 'react'
import { effortProfile } from '../agent/effort.js'
import { PERMISSION_MODE_INFO } from '../agent/permissions.js'
import { BUILTIN_TOOLS } from '../agent/tools/builtin.js'
import {
  contextBreakdown,
  sharePercent,
  type ContextBreakdown,
  type ContextSlice
} from '../lib/context.js'
import { formatTokens } from '../lib/format.js'
import { MIN_MESSAGES_TO_COMPACT, useApp } from '../store/app.js'
import { Menu } from './Menu.js'

const CHIP = 'rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-raised hover:text-ink'

// --- Context ---------------------------------------------------------------

/** Donut showing how full the context window is. */
function Ring({ fraction }: { fraction: number }): React.ReactElement {
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const filled = Math.min(1, Math.max(0, fraction))
  const colour = filled > 0.92 ? 'text-bad' : filled > 0.8 ? 'text-warn' : 'text-brand'

  return (
    <svg viewBox="0 0 18 18" className={`h-4 w-4 -rotate-90 ${colour}`} aria-hidden>
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.2"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - filled)}
        className="fg-ring"
      />
    </svg>
  )
}

/**
 * One line of the breakdown. Every row — parent, child and the free-space row
 * — goes through here so the four columns stay on the same grid; they used to
 * be built separately and drifted apart by a couple of pixels.
 */
function SliceRow({
  label,
  tokens,
  colour,
  share,
  depth = 0,
  open,
  onToggle,
  muted
}: {
  label: string
  tokens: number
  /** Tailwind background class, or null for the hollow free-space swatch. */
  colour: string | null
  share: number
  depth?: number
  open?: boolean
  onToggle?: () => void
  muted?: boolean
}): React.ReactElement {
  const body = (
    <>
      <span
        aria-hidden
        className={`w-2.5 shrink-0 text-[10px] leading-none text-faint transition-transform ${
          open ? 'rotate-90' : ''
        }`}
      >
        {onToggle ? '›' : ''}
      </span>
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-sm ${colour ?? 'border border-line'}`}
        aria-hidden
      />
      <span className={`min-w-0 flex-1 truncate ${muted ? 'text-faint' : 'text-muted'}`}>
        {label}
      </span>
      <span className={`shrink-0 tabular-nums ${muted ? 'text-muted' : 'text-ink'}`}>
        {formatTokens(tokens)}
      </span>
      <span className="w-12 shrink-0 text-right tabular-nums text-faint">
        {share < 0.05 ? '<0.1%' : `${share.toFixed(1)}%`}
      </span>
    </>
  )

  const shape = 'flex w-full items-center gap-2 rounded py-[3px] pr-1 text-left text-[11.5px]'
  const indent = { paddingLeft: `${depth * 14 + 4}px` }

  return (
    <li>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`${shape} hover:bg-raised`}
          style={indent}
        >
          {body}
        </button>
      ) : (
        <div className={shape} style={indent}>
          {body}
        </div>
      )}
    </li>
  )
}

function SliceRows({
  slices,
  limit,
  used,
  depth = 0
}: {
  slices: ContextSlice[]
  limit: number | null
  used: number
  depth?: number
}): React.ReactElement {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <>
      {slices.map((slice) => {
        const children = slice.children ?? []
        const expanded = open === slice.id

        return (
          <Fragment key={slice.id}>
            <SliceRow
              label={slice.label}
              tokens={slice.tokens}
              colour={slice.colour}
              share={sharePercent(slice.tokens, limit, used)}
              depth={depth}
              {...(children.length
                ? { open: expanded, onToggle: () => setOpen(expanded ? null : slice.id) }
                : {})}
            />
            {expanded && children.length > 0 && (
              <SliceRows slices={children} limit={limit} used={used} depth={depth + 1} />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

/** Proportional bar built from the same slices as the rows below it. */
function StackedBar({ breakdown }: { breakdown: ContextBreakdown }): React.ReactElement {
  const total = breakdown.limit ?? breakdown.used

  return (
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-line">
      {breakdown.slices.map((slice) => (
        <div
          key={slice.id}
          className={`fg-meter h-full ${slice.colour}`}
          style={{ width: `${total ? (slice.tokens / total) * 100 : 0}%` }}
          title={`${slice.label} — ${formatTokens(slice.tokens)}`}
        />
      ))}
    </div>
  )
}

/** The full accounting, reconciled against the server's own count. */
function useBreakdown(): ContextBreakdown | null {
  const messages = useApp((s) => s.messages)
  const mcpTools = useApp((s) => s.mcpTools)
  const config = useApp((s) => s.config)
  const attachments = useApp((s) => s.attachments)
  const contextTokens = useApp((s) => s.contextTokens)
  const projectInstructions = useApp((s) => s.projectInstructions)
  const usage = useApp((s) => s.usage)

  if (!config) return null

  return contextBreakdown({
    messages,
    mcpTools,
    builtinTools: BUILTIN_TOOLS.map((t) => t.definition),
    config,
    attachments,
    projectInstructions,
    limit: contextTokens,
    measured: usage?.prompt ?? null
  })
}

function Breakdown({ breakdown }: { breakdown: ContextBreakdown }): React.ReactElement {
  const ordered = breakdown.slices.slice().sort((a, b) => b.tokens - a.tokens)
  const free = breakdown.limit === null ? null : breakdown.free

  return (
    <div className="fg-unfold mt-2 border-t border-line pt-2">
      <ul>
        <SliceRows slices={ordered} limit={breakdown.limit} used={breakdown.used} />

        {free !== null && (
          <>
            <li aria-hidden className="my-1 border-t border-line/60" />
            <SliceRow
              label="Free space"
              tokens={free}
              colour={null}
              share={sharePercent(free, breakdown.limit, breakdown.used)}
              muted
            />
          </>
        )}
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        {breakdown.fromServer
          ? 'Totals come from the server. The rows are estimated from the conversation, so whatever they cannot account for is listed as "not itemised".'
          : 'Estimated from the conversation until the model reports its own count, so these figures are approximate.'}{' '}
        Command output is counted here, unlike in the per-turn figure.
      </p>
    </div>
  )
}

export function ContextRing(): React.ReactElement {
  const [detailed, setDetailed] = useState(false)
  const contextTokens = useApp((s) => s.contextTokens)
  const compact = useApp((s) => s.compact)
  const streaming = useApp((s) => s.streaming)
  const messages = useApp((s) => s.messages)
  const autoAt = useApp((s) => s.config?.agent.autoCompactAt ?? 0)
  const breakdown = useBreakdown()

  // One number everywhere: the ring, the header and the rows all read from the
  // same total, so the popup can no longer contradict itself.
  const used = breakdown?.used ?? 0
  const fraction = contextTokens ? used / contextTokens : 0
  const percent = Math.round(fraction * 100)

  const blocked = streaming
    ? 'Finishes after the current turn.'
    : messages.length < MIN_MESSAGES_TO_COMPACT
      ? 'Nothing to compact yet — send a message first.'
      : null

  return (
    <Menu
      label="Context window"
      triggerId="fg-context-ring"
      triggerTitle={
        contextTokens
          ? `Context ${formatTokens(used)} / ${formatTokens(contextTokens)} (${percent}%)`
          : 'Context size unknown'
      }
      triggerClassName="flex items-center rounded-md p-1 hover:bg-raised"
      trigger={<Ring fraction={fraction} />}
    >
      {(close) => (
        <div className="w-72">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-ink">Context window</span>
            <span className="font-mono text-[11.5px] text-muted">
              {contextTokens
                ? `${formatTokens(used)} / ${formatTokens(contextTokens)} (${percent}%)`
                : 'unknown'}
            </span>
          </div>

          {/* Expanded, the bar is split by slice so it reads as the same
              accounting as the rows; collapsed, it is a single fill. */}
          {detailed && breakdown ? (
            <StackedBar breakdown={breakdown} />
          ) : (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={`fg-meter h-full ${fraction > 0.92 ? 'bg-bad' : fraction > 0.8 ? 'bg-warn' : 'bg-brand'}`}
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
          )}

          <button
            type="button"
            id="fg-context-breakdown"
            onClick={() => setDetailed((v) => !v)}
            aria-expanded={detailed}
            disabled={!breakdown}
            className="mt-2.5 flex w-full items-center gap-1.5 text-[11.5px] text-faint hover:text-muted disabled:opacity-50"
          >
            <span
              aria-hidden
              className={`inline-block transition-transform ${detailed ? 'rotate-90' : ''}`}
            >
              &rsaquo;
            </span>
            {detailed ? 'Hide breakdown' : 'What is using the context'}
          </button>

          {detailed && breakdown && <Breakdown breakdown={breakdown} />}

          <div className="mt-3 border-t border-line pt-3">
            <button
              type="button"
              disabled={blocked !== null}
              onClick={() => {
                close()
                void compact()
              }}
              className="w-full rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Compact conversation
            </button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              {blocked ??
                'Replaces the history with a summary so work can continue in a fresh window.'}
              {autoAt > 0 && !blocked && ` Happens on its own at ${Math.round(autoAt * 100)}%.`}
            </p>
          </div>
        </div>
      )}
    </Menu>
  )
}

// --- Effort ----------------------------------------------------------------

export function EffortControl(): React.ReactElement {
  const session = useApp((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const setEffort = useApp((s) => s.setEffort)

  const level: EffortLevel = session?.effort ?? 'high'
  const index = EFFORT_ORDER.indexOf(level)
  const profile = effortProfile(level)

  return (
    <Menu
      label="Effort"
      triggerId="fg-effort"
      triggerTitle={`Effort: ${profile.label}`}
      triggerClassName={`${CHIP} ${profile.workflows ? 'text-brand' : ''}`}
      trigger={profile.label}
    >
      {() => (
        <div className="w-72">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-ink">Effort</span>
            <span className={`text-[12.5px] ${profile.workflows ? 'text-brand' : 'text-muted'}`}>
              {profile.label}
            </span>
          </div>

          <div className="mt-3 flex justify-between text-[11px] text-faint">
            <span>Faster</span>
            <span>Smarter</span>
          </div>

          <div className="mt-1.5 flex items-center justify-between rounded-full bg-raised px-2 py-2">
            {EFFORT_ORDER.map((option, i) => {
              const isTop = effortProfile(option).workflows
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => void setEffort(option)}
                  aria-label={effortProfile(option).label}
                  aria-pressed={i === index}
                  className="relative flex h-4 w-4 items-center justify-center"
                >
                  <span
                    className={`rounded-full transition-all duration-200 ease-out ${
                      i === index
                        ? `h-4 w-4 shadow ${isTop ? 'bg-brand' : 'bg-ink'}`
                        : isTop
                          ? 'h-1.5 w-1.5 bg-brand/60'
                          : 'h-1 w-1 bg-faint'
                    }`}
                  />
                </button>
              )
            })}
          </div>

          <dl className="mt-3 space-y-1 text-[11.5px] text-muted">
            <div className="flex justify-between">
              <dt>Reasoning</dt>
              <dd>
                {profile.thinkingBudget === 0
                  ? 'off'
                  : `~${formatTokens(profile.thinkingBudget)} tokens`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Tool steps</dt>
              <dd className="tabular-nums">{profile.maxIterations}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Reply cap</dt>
              <dd className="tabular-nums">
                {formatTokens(profile.maxTokens)}
                {profile.thinkingBudget > 0 && (
                  <span className="text-faint"> +{formatTokens(profile.thinkingBudget)} think</span>
                )}
              </dd>
            </div>
            {profile.workflows && (
              <div className="flex justify-between text-brand">
                <dt>Workflows</dt>
                <dd className="tabular-nums">up to {profile.maxParallelSubtasks} subtasks</dd>
              </div>
            )}
          </dl>

          {profile.workflows && (
            <p className="mt-2 rounded-md border border-brand/40 bg-brand-soft/40 px-2 py-1.5 text-[11px] text-muted">
              Hypercode delegates work to parallel sub-agents and reviews its own output. For real
              parallelism, raise <b className="text-ink">concurrent predictions</b> to{' '}
              {profile.maxParallelSubtasks} in LM Studio&rsquo;s server settings — otherwise the
              subtasks simply queue.
            </p>
          )}
        </div>
      )}
    </Menu>
  )
}

// --- Permission mode -------------------------------------------------------

const MODE_TONE: Record<PermissionMode, string> = {
  manual: 'text-muted',
  acceptEdits: 'text-ok',
  plan: 'text-brand',
  auto: 'text-muted',
  bypass: 'text-warn'
}

export function ModeSwitcher(): React.ReactElement {
  const session = useApp((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const setPermissionMode = useApp((s) => s.setPermissionMode)
  const bypassAllowed = useApp((s) => s.config?.allowBypassMode ?? false)

  const mode: PermissionMode = session?.permissionMode ?? 'manual'
  const info = PERMISSION_MODE_INFO.find((m) => m.id === mode)
  const available = PERMISSION_MODE_INFO.filter((m) => m.id !== 'bypass' || bypassAllowed)

  return (
    <Menu
      label="Permission mode"
      align="left"
      triggerId="fg-mode"
      triggerTitle="Permission mode — Shift+Tab to cycle"
      triggerClassName={`rounded-md bg-raised px-2 py-1 text-[11.5px] ${MODE_TONE[mode]} hover:opacity-80`}
      trigger={info?.label ?? mode}
      onDigit={(index, close) => {
        const option = available[index]
        if (!option) return
        close()
        void setPermissionMode(option.id)
      }}
    >
      {(close) => (
        <div className="w-72">
          <span className="text-[11px] uppercase tracking-wide text-faint">Mode</span>
          <ul className="mt-1.5">
            {available.map((option, i) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    void setPermissionMode(option.id)
                  }}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-raised ${
                    option.id === mode ? 'bg-raised' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-ink">{option.label}</div>
                    <div className="text-[11px] text-faint">{option.description}</div>
                  </div>
                  <span className="mt-0.5 shrink-0 text-[11px] text-faint">
                    {option.id === mode ? '✓' : i + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-line pt-2 text-[11px] text-faint">
            {bypassAllowed
              ? 'Shift+Tab cycles. A tool on your deny list stays blocked in every mode.'
              : 'Shift+Tab cycles. Bypass is off — enable it in Settings if you want it.'}
          </p>
        </div>
      )}
    </Menu>
  )
}

// --- Model -----------------------------------------------------------------

export function ModelPicker(): React.ReactElement {
  const models = useApp((s) => s.models)
  const session = useApp((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const setSessionModel = useApp((s) => s.setSessionModel)
  const connection = useApp((s) => s.connection)
  const refreshModels = useApp((s) => s.refreshModels)

  const current = session?.model ?? ''
  const shortName = current ? (current.split('/').pop() ?? current) : 'no model'

  return (
    <Menu
      label="Model"
      triggerId="fg-model-picker"
      triggerTitle={current || 'No model selected'}
      triggerClassName={`${CHIP} max-w-[15rem] truncate font-mono`}
      trigger={shortName}
    >
      {(close) => (
        <div className="w-80">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-ink">Model</span>
            <button
              type="button"
              onClick={() => void refreshModels()}
              className="text-[11px] text-faint hover:text-ink"
            >
              refresh
            </button>
          </div>

          {connection !== 'ok' && (
            <p className="mt-2 rounded-md border border-warn/40 bg-warn/8 px-2 py-1.5 text-[11px] text-muted">
              LM Studio is not reachable. Start its local server, then refresh.
            </p>
          )}

          <ul className="mt-2 max-h-72 overflow-y-auto">
            {models.length === 0 && (
              <li className="px-2 py-1.5 text-[11.5px] text-faint">No models available.</li>
            )}
            {models.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    void setSessionModel(model.id)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-raised ${
                    model.id === current ? 'bg-raised' : ''
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${model.loaded ? 'bg-ok' : 'bg-faint'}`}
                    title={model.loaded ? 'loaded' : 'not loaded'}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                    {model.id}
                  </span>
                  {model.contextLength && (
                    <span className="shrink-0 text-[11px] text-faint">
                      {formatTokens(model.contextLength)}
                    </span>
                  )}
                  {model.id === current && (
                    <span className="shrink-0 text-[11px] text-brand">✓</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-2 border-t border-line pt-2 text-[11px] text-faint">
            A green dot means the model is loaded in LM Studio. Picking an unloaded model makes it
            load on the first message, which takes a while.
          </p>
        </div>
      )}
    </Menu>
  )
}

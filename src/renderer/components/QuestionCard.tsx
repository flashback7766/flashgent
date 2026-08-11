import type { AskAnswer, AskQuestion } from '@shared/types'
import { useEffect, useState } from 'react'
import { useApp } from '../store/app.js'

interface Draft {
  selected: Set<number>
  other: string
  otherChecked: boolean
}

const emptyDraft = (): Draft => ({ selected: new Set(), other: '', otherChecked: false })

function toAnswer(question: AskQuestion, draft: Draft, skipped: boolean): AskAnswer {
  return {
    question: question.question,
    selected: [...draft.selected].sort((a, b) => a - b).map((i) => question.options[i]?.label ?? ''),
    other: draft.otherChecked || !question.multiSelect ? draft.other : '',
    skipped
  }
}

/**
 * The agent's clarification card.
 *
 * One question at a time with an `N/M` stepper. Single-choice rows carry a
 * digit badge and commit on click; multi-choice rows carry a checkbox and wait
 * for Next. "Other" is always last, with a free-text field, because the point
 * of asking is to find out — not to force an answer into one of four boxes.
 */
export function QuestionCard(): React.ReactElement | null {
  const request = useApp((s) => s.pendingAsk)
  const resolve = useApp((s) => s.resolveAsk)

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<AskAnswer[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [collapsed, setCollapsed] = useState(false)

  const questions = request?.questions ?? []
  const question = questions[index]

  // A fresh request starts over.
  useEffect(() => {
    setIndex(0)
    setAnswers([])
    setDraft(emptyDraft())
    setCollapsed(false)
  }, [request])

  const commit = (answer: AskAnswer): void => {
    const next = [...answers]
    next[index] = answer
    setAnswers(next)

    if (index + 1 < questions.length) {
      const upcoming = next[index + 1]
      setIndex(index + 1)
      setDraft(upcoming ? draftFrom(questions[index + 1], upcoming) : emptyDraft())
      return
    }

    // Anything the user never reached counts as skipped.
    const complete = questions.map(
      (q, i) => next[i] ?? { question: q.question, selected: [], other: '', skipped: true }
    )
    resolve(complete)
  }

  const draftFrom = (q: AskQuestion | undefined, answer: AskAnswer): Draft => {
    if (!q) return emptyDraft()
    const selected = new Set<number>()
    q.options.forEach((option, i) => {
      if (answer.selected.includes(option.label)) selected.add(i)
    })
    return { selected, other: answer.other, otherChecked: Boolean(answer.other) }
  }

  const choose = (optionIndex: number): void => {
    if (!question) return

    if (question.multiSelect) {
      const selected = new Set(draft.selected)
      if (selected.has(optionIndex)) selected.delete(optionIndex)
      else selected.add(optionIndex)
      setDraft({ ...draft, selected })
      return
    }

    // Single choice commits straight away: an extra confirm click buys nothing.
    commit(
      toAnswer(question, { selected: new Set([optionIndex]), other: '', otherChecked: false }, false)
    )
  }

  const toggleOther = (): void => {
    if (!question) return
    if (question.multiSelect) {
      setDraft({ ...draft, otherChecked: !draft.otherChecked })
      return
    }
    // For a single choice, "Other" just means "the text field is my answer".
    setDraft({ ...draft, selected: new Set(), otherChecked: true })
  }

  // Digits pick an option; Enter advances.
  useEffect(() => {
    if (!question || collapsed) return

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          commit(toAnswer(question, draft, false))
        }
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        commit(toAnswer(question, draft, false))
        return
      }

      const digit = Number(event.key)
      if (Number.isNaN(digit) || digit < 1) return
      event.preventDefault()

      if (digit === question.options.length + 1) toggleOther()
      else if (digit <= question.options.length) choose(digit - 1)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })

  if (!request || !question) return null

  const otherBadge = question.options.length + 1
  const answered = draft.selected.size > 0 || (draft.otherChecked && draft.other.trim().length > 0)

  return (
    <div className="fg-enter px-6 py-3">
      <div
        role="dialog"
        aria-label="Clarification"
        className="mx-auto fg-column overflow-hidden rounded-xl border border-line bg-surface"
      >
        <header className="flex items-center gap-2 px-3 py-2.5">
          <span className="shrink-0 rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[11px] text-warn">
            {index + 1}/{questions.length}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
            {question.question}
          </h3>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            className="shrink-0 px-1 text-[13px] text-faint hover:text-ink"
          >
            {collapsed ? '⌃' : '⌄'}
          </button>
          <button
            type="button"
            onClick={() => resolve(questions.map((q) => ({
              question: q.question,
              selected: [],
              other: '',
              skipped: true
            })))}
            aria-label="Dismiss and let flashgent decide"
            className="shrink-0 px-1 text-[14px] leading-none text-faint hover:text-ink"
          >
            &times;
          </button>
        </header>

        {!collapsed && (
          <div className="fg-unfold">
            <ul>
              {question.options.map((option, i) => {
                const picked = draft.selected.has(i)
                return (
                  <li key={option.label}>
                    <button
                      type="button"
                      onClick={() => choose(i)}
                      aria-pressed={picked}
                      className={`flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-raised ${
                        picked ? 'bg-raised' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] text-ink">{option.label}</span>
                        {option.description && (
                          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">
                            {option.description}
                          </span>
                        )}
                      </span>
                      <Marker multi={question.multiSelect} checked={picked} badge={i + 1} />
                    </button>
                  </li>
                )
              })}

              <li>
                <button
                  type="button"
                  onClick={toggleOther}
                  aria-pressed={draft.otherChecked}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-raised ${
                    draft.otherChecked ? 'bg-raised' : ''
                  }`}
                >
                  <span className="flex-1 text-[12.5px] text-ink">Other</span>
                  <Marker
                    multi={question.multiSelect}
                    checked={draft.otherChecked}
                    badge={otherBadge}
                  />
                </button>
              </li>
            </ul>

            <div className="px-3 pb-2">
              <input
                value={draft.other}
                onChange={(e) => setDraft({ ...draft, other: e.target.value, otherChecked: true })}
                placeholder="Type your own answer here"
                aria-label="Your own answer"
                className="w-full rounded-md bg-raised px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:bg-line/40"
              />
            </div>

            <footer className="flex items-center gap-2 px-3 pb-3">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const previous = index - 1
                    setIndex(previous)
                    const existing = answers[previous]
                    setDraft(existing ? draftFrom(questions[previous], existing) : emptyDraft())
                  }}
                  className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
                >
                  Back
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => commit(toAnswer(question, draft, true))}
                  className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => commit(toAnswer(question, draft, false))}
                  disabled={!answered}
                  className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-30"
                >
                  {index + 1 === questions.length ? 'Done' : 'Next'}
                </button>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}

/** Digit badge for a single choice, checkbox for a multiple one. */
function Marker({
  multi,
  checked,
  badge
}: {
  multi: boolean
  checked: boolean
  badge: number
}): React.ReactElement {
  if (multi) {
    return (
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
          checked ? 'border-brand bg-brand text-white' : 'border-line text-transparent'
        }`}
      >
        &#10003;
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line font-mono text-[11px] text-faint"
    >
      {badge}
    </span>
  )
}

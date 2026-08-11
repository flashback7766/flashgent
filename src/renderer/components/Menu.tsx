import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface MenuProps {
  /** Contents of the trigger button. */
  trigger: ReactNode
  triggerTitle?: string
  triggerClassName?: string
  /** Stable handle for tests and for focusing from a slash command. */
  triggerId?: string
  label: string
  align?: 'left' | 'right'
  /** Panel body. `close` lets an item dismiss the menu after acting. */
  children: (close: () => void) => ReactNode
  /** Called with a digit key while the menu is open. */
  onDigit?: (index: number, close: () => void) => void
}

/**
 * A dropdown that owns its own trigger.
 *
 * Owning the trigger is the point: when the panel handled outside-clicks by
 * itself, a click on the trigger counted as "outside", so the menu closed and
 * the very same click reopened it — it looked like clicking did nothing.
 * Containment is now tested against the wrapper, so the trigger's own click
 * only ever runs the toggle.
 */
export function Menu({
  trigger,
  triggerTitle,
  triggerClassName,
  triggerId,
  label,
  align = 'right',
  children,
  onDigit
}: MenuProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const close = (): void => setOpen(false)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const wrapper = wrapperRef.current
      if (wrapper && !wrapper.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        return
      }
      if (!onDigit) return
      const index = Number(event.key) - 1
      if (Number.isNaN(index) || index < 0) return
      event.preventDefault()
      onDigit(index, close)
    }

    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onDigit])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        id={triggerId}
        onClick={() => setOpen((v) => !v)}
        title={triggerTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`fg-pop absolute bottom-full z-30 mb-2 rounded-xl border border-line bg-surface p-3 shadow-2xl ${
            align === 'right' ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left'
          }`}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from './Popover.js'

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
 * A dropdown that owns its own trigger, powered by Radix UI Popover primitives.
 *
 * Trigger ownership, outside click dismissal, focus trapping, and Escape handling
 * are managed by Radix UI rather than custom document listeners.
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

  const close = (): void => setOpen(false)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!onDigit) return
    const index = Number(event.key) - 1
    if (Number.isNaN(index) || index < 0) return
    event.preventDefault()
    onDigit(index, close)
  }

  const radixAlign = align === 'left' ? 'start' : 'end'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" id={triggerId} title={triggerTitle} className={triggerClassName}>
          {trigger}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={radixAlign}
        side="top"
        sideOffset={8}
        aria-label={label}
        onKeyDown={handleKeyDown}
        className={align === 'right' ? 'origin-bottom-right' : 'origin-bottom-left'}
      >
        {children(close)}
      </PopoverContent>
    </Popover>
  )
}

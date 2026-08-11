import { useEffect, useRef, type ReactNode } from 'react'

interface PopoverProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Which edge of the trigger the panel hangs from. */
  align?: 'left' | 'right'
  label: string
}

/**
 * A small panel anchored above its trigger. Closes on Escape, on a click
 * outside, and on scroll, so it never floats detached from what opened it.
 */
export function Popover({
  open,
  onClose,
  children,
  align = 'right',
  label
}: PopoverProps): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const node = ref.current
      if (node && !node.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    // Capture phase: close before the click reaches whatever is underneath.
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`fg-enter absolute bottom-full z-30 mb-2 rounded-xl border border-line bg-surface p-3 shadow-2xl ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {children}
    </div>
  )
}

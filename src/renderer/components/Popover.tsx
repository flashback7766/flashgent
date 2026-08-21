import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ComponentPropsWithoutRef, ReactElement } from 'react'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverPortal = PopoverPrimitive.Portal
export const PopoverClose = PopoverPrimitive.Close

export interface PopoverContentProps extends ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> {
  className?: string
}

/**
 * Portaled popover panel anchored to its trigger, managed by Radix UI.
 *
 * Radix manages focus trapping, outside clicks, collision boundaries, and Escape key
 * dismissals without custom document event listeners.
 */
export function PopoverContent({
  className = '',
  align = 'end',
  side = 'top',
  sideOffset = 8,
  children,
  ...props
}: PopoverContentProps): ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={`fg-pop z-30 rounded-xl border border-line bg-surface p-3 shadow-2xl outline-none ${className}`}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

import { describe, expect, it } from 'vitest'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverPortal,
  PopoverClose
} from '../../src/renderer/components/Popover.js'
import { Menu } from '../../src/renderer/components/Menu.js'

describe('Popover and Menu components', () => {
  it('exports Radix UI popover primitive components', () => {
    expect(Popover).toBeDefined()
    expect(PopoverTrigger).toBeDefined()
    expect(PopoverContent).toBeDefined()
    expect(PopoverAnchor).toBeDefined()
    expect(PopoverPortal).toBeDefined()
    expect(PopoverClose).toBeDefined()
  })

  it('exports Menu component', () => {
    expect(Menu).toBeDefined()
  })
})

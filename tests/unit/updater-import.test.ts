import { describe, expect, it } from 'vitest'

describe('updater ESM import', () => {
  it('loads without CJS named-export crash', async () => {
    const mod = await import('electron-updater')
    expect(mod).toBeTruthy()
    expect(mod.default).toBeTruthy()
  })
})

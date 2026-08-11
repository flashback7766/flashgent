import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  measuredRate,
  prefillProgress,
  prefillRate,
  recordPrefill
} from '../../src/renderer/lib/prefill.js'

/** The module persists through localStorage, which node does not provide. */
function installStorage(): void {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear()
  })
}

beforeEach(installStorage)

describe('recordPrefill', () => {
  it('learns a rate from one measurement', () => {
    // 2000 tokens in 2 seconds, minus the fixed per-request overhead.
    recordPrefill('m', 2000, 2000)
    expect(measuredRate('m')).toBeGreaterThan(1000)
  })

  it('does not blame per-request overhead on the hardware', () => {
    // Same throughput, different prompt sizes: the learned rate should agree.
    recordPrefill('short', 1000, 400 + 1000)
    recordPrefill('long', 10_000, 400 + 10_000)

    const short = measuredRate('short') ?? 0
    const long = measuredRate('long') ?? 0
    expect(Math.abs(short - long) / long).toBeLessThan(0.05)
  })

  it('ignores samples too small to mean anything', () => {
    recordPrefill('m', 10, 4000)
    recordPrefill('m', 5000, 10)
    expect(measuredRate('m')).toBeNull()
  })

  it('smooths towards a new rate instead of jumping to it', () => {
    recordPrefill('m', 2000, 2400) // ~1000 t/s
    recordPrefill('m', 2000, 1400) // ~2000 t/s

    const rate = measuredRate('m') ?? 0
    expect(rate).toBeGreaterThan(1000)
    expect(rate).toBeLessThan(2000)
  })

  it('keeps a rate per model', () => {
    recordPrefill('fast', 4000, 1000)
    recordPrefill('slow', 1000, 4000)

    expect(measuredRate('fast')).toBeGreaterThan(measuredRate('slow') ?? 0)
  })
})

describe('prefillRate', () => {
  it('falls back to a starting guess so the bar shows on the first message', () => {
    expect(measuredRate('never-seen')).toBeNull()
    expect(prefillRate('never-seen')).toBeGreaterThan(0)
  })

  it('prefers a real measurement over the guess', () => {
    recordPrefill('m', 8000, 1400) // far off the seed
    expect(prefillRate('m')).toBeGreaterThan(5000)
  })
})

describe('prefillProgress', () => {
  it('reports progress even before anything has been measured', () => {
    const { percent } = prefillProgress('never-seen', 4000, 1000)
    expect(percent).not.toBeNull()
    expect(percent).toBeGreaterThanOrEqual(0)
  })

  it('runs slower than the real rate, so the bar never parks at the end', () => {
    recordPrefill('m', 2000, 2400) // ~1000 tokens/second measured

    // 4000 tokens is ~4s of real work; halfway through, honest progress would
    // read 50%. The bar is deliberately behind that.
    const { percent } = prefillProgress('m', 4000, 2000)
    expect(percent).toBeLessThan(50)
    expect(percent).toBeGreaterThan(15)
  })

  it('scales with the size of the prompt', () => {
    recordPrefill('m', 2000, 2400)

    const small = prefillProgress('m', 1000, 1000).percent ?? 0
    const large = prefillProgress('m', 20_000, 1000).percent ?? 0
    expect(small).toBeGreaterThan(large)
  })

  it('never claims to be finished', () => {
    recordPrefill('m', 2000, 2000)
    expect(prefillProgress('m', 4000, 600_000).percent).toBe(99)
    expect(prefillProgress('m', 4000, 600_000).remainingSeconds).toBe(0)
  })

  it('starts at zero rather than a negative', () => {
    recordPrefill('m', 2000, 2000)
    expect(prefillProgress('m', 4000, 0).percent).toBe(0)
  })

  it('has nothing to report without a prompt to measure against', () => {
    expect(prefillProgress('m', 0, 500)).toEqual({ percent: null, remainingSeconds: null })
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyEffort,
  effortProfile,
  hasWorkflows,
  replyCapFor
} from '../../src/renderer/agent/effort.js'
import { EFFORT_ORDER, type ModelPreset } from '../../src/shared/types.js'

const preset: ModelPreset = { id: 'p', name: 'P', temperature: 0.5, maxTokens: 4096 }

describe('effortProfile', () => {
  it('covers every level', () => {
    for (const level of EFFORT_ORDER) {
      expect(effortProfile(level).level).toBe(level)
    }
  })

  it('increases the step budget monotonically', () => {
    const steps = EFFORT_ORDER.map((l) => effortProfile(l).maxIterations)
    const sorted = [...steps].sort((a, b) => a - b)
    expect(steps).toEqual(sorted)
  })

  it('increases the reasoning budget monotonically', () => {
    const budgets = EFFORT_ORDER.map((l) => effortProfile(l).thinkingBudget)
    expect(budgets).toEqual([...budgets].sort((a, b) => a - b))
  })

  it('turns forced reasoning off only at the lowest level', () => {
    expect(effortProfile('minimal').thinkingBudget).toBe(0)
    for (const level of EFFORT_ORDER.filter((l) => l !== 'minimal')) {
      expect(effortProfile(level).thinkingBudget).toBeGreaterThan(0)
    }
  })

  it('falls back to high for an unknown level', () => {
    expect(effortProfile('nonsense' as never).level).toBe('high')
  })

  describe('hypercode', () => {
    it('sits above maximum on every axis', () => {
      const top = effortProfile('hypercode')
      const max = effortProfile('max')

      expect(EFFORT_ORDER.at(-1)).toBe('hypercode')
      expect(top.thinkingBudget).toBeGreaterThan(max.thinkingBudget)
      expect(top.maxIterations).toBeGreaterThan(max.maxIterations)
      expect(top.temperatureDelta).toBeLessThan(max.temperatureDelta)
    })

    it('is the only level with workflows', () => {
      expect(hasWorkflows('hypercode')).toBe(true)
      for (const level of EFFORT_ORDER.filter((l) => l !== 'hypercode')) {
        expect(hasWorkflows(level)).toBe(false)
      }
    })

    it('allows a bounded fan-out of subtasks', () => {
      expect(effortProfile('hypercode').maxParallelSubtasks).toBe(10)
      expect(effortProfile('max').maxParallelSubtasks).toBe(0)
    })
  })
})

describe('applyEffort', () => {
  it('samples more tightly as effort rises', () => {
    const low = applyEffort(preset, 'low').temperature
    const max = applyEffort(preset, 'max').temperature
    expect(max).toBeLessThan(low)
  })

  it('keeps temperature inside the valid range', () => {
    const hot: ModelPreset = { ...preset, temperature: 1.95 }
    expect(applyEffort(hot, 'minimal').temperature).toBeLessThanOrEqual(2)

    const cold: ModelPreset = { ...preset, temperature: 0.05 }
    expect(applyEffort(cold, 'max').temperature).toBeGreaterThanOrEqual(0)
  })

  it('caps the reply at the preset, whatever the effort level', () => {
    const small: ModelPreset = { ...preset, maxTokens: 512 }
    for (const level of EFFORT_ORDER) {
      expect(replyCapFor(small, level)).toBeLessThanOrEqual(512)
    }
  })

  it('lowers the reply cap when the effort level is cheaper than the preset', () => {
    expect(replyCapFor(preset, 'minimal')).toBe(1024)
  })

  it('adds headroom so reasoning cannot eat the whole reply budget', () => {
    // Reasoning tokens are billed against max_tokens: without headroom the
    // model returns an empty message with finish_reason "length".
    for (const level of EFFORT_ORDER) {
      const requested = applyEffort(preset, level).maxTokens
      const reply = replyCapFor(preset, level)
      expect(requested).toBeGreaterThanOrEqual(reply + effortProfile(level).thinkingBudget)
    }
  })

  it('asks for nothing extra when reasoning is switched off', () => {
    expect(applyEffort(preset, 'minimal').maxTokens).toBe(replyCapFor(preset, 'minimal'))
  })

  it('leaves the preset object untouched', () => {
    const before = { ...preset }
    applyEffort(preset, 'max')
    expect(preset).toEqual(before)
  })
})

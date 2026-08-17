import { describe, expect, it } from 'vitest'
import { DATASET_30_SCENARIOS } from './datasets.js'
import { executeScenario, runBenchmark } from './runner.js'

describe('Flashgent Benchmark Suite (30 Scenarios, 100-Point System)', () => {
  it('contains exactly 30 scenarios partitioned into Easy (15), Medium (10), and Hard (5)', () => {
    expect(DATASET_30_SCENARIOS.length).toBe(30)
    const easy = DATASET_30_SCENARIOS.filter((s) => s.tier === 'easy')
    const med = DATASET_30_SCENARIOS.filter((s) => s.tier === 'medium')
    const hard = DATASET_30_SCENARIOS.filter((s) => s.tier === 'hard')

    expect(easy.length).toBe(15)
    expect(med.length).toBe(10)
    expect(hard.length).toBe(5)

    const basePoints =
      easy.reduce((s, x) => s + x.points, 0) +
      med.reduce((s, x) => s + x.points, 0) +
      hard.reduce((s, x) => s + x.points, 0)

    expect(basePoints).toBe(70)
  })

  // Validate each individual scenario assertion
  for (const scenario of DATASET_30_SCENARIOS) {
    it(`executes [${scenario.tier.toUpperCase()}] ${scenario.id}: ${scenario.name}`, async () => {
      const result = await executeScenario(scenario)
      expect(result.passed, result.message ?? `Scenario ${scenario.id} failed`).toBe(true)
      expect(result.earnedPoints).toBe(scenario.points)
    })
  }

  it('generates full 100-point benchmark report with JSON file output and quality modifiers', async () => {
    const report = await runBenchmark('Vitest Test Runner (Flashgent Agent Suite)')
    expect(report.totalPoints).toBe(100)
    expect(report.percentage).toBe(100)
    expect(report.summary.easy.passed).toBe(15)
    expect(report.summary.medium.passed).toBe(10)
    expect(report.summary.hard.passed).toBe(5)
    expect(report.qualityModifiers.totalModifier).toBe(30)
  })
})

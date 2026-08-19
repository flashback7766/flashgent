import { describe, expect, it } from 'vitest'
import { DATASET_100_SCENARIOS } from './datasets.js'
import { executeScenario, runBenchmark } from './runner.js'

describe('Flashgent Benchmark Suite (100 Scenarios, 100-Point Standard)', () => {
  it('contains exactly 100 scenarios partitioned into Easy (50), Medium (30), Hard (15), and Hell (5)', () => {
    expect(DATASET_100_SCENARIOS.length).toBe(100)
    const easy = DATASET_100_SCENARIOS.filter((s) => s.tier === 'easy')
    const med = DATASET_100_SCENARIOS.filter((s) => s.tier === 'medium')
    const hard = DATASET_100_SCENARIOS.filter((s) => s.tier === 'hard')
    const hell = DATASET_100_SCENARIOS.filter((s) => s.tier === 'hell')

    expect(easy.length).toBe(50)
    expect(med.length).toBe(30)
    expect(hard.length).toBe(15)
    expect(hell.length).toBe(5)

    const rawPoints =
      easy.reduce((s, x) => s + x.points, 0) +
      med.reduce((s, x) => s + x.points, 0) +
      hard.reduce((s, x) => s + x.points, 0) +
      hell.reduce((s, x) => s + x.points, 0)

    expect(rawPoints).toBe(185)
  })

  // Validate each individual scenario assertion
  for (const scenario of DATASET_100_SCENARIOS) {
    it(`executes [${scenario.tier.toUpperCase()}] ${scenario.id}: ${scenario.name}`, async () => {
      const result = await executeScenario(scenario)
      expect(result.passed, result.message ?? `Scenario ${scenario.id} failed`).toBe(true)
      expect(result.earnedPoints).toBe(scenario.points)
    })
  }

  it('generates full 100-point benchmark report with JSON file output and quality modifiers', async () => {
    const report = await runBenchmark('Vitest Test Runner (Flashgent Agent Suite)', undefined, undefined, { concurrency: 4 })
    expect(report.totalScore).toBe(100)
    expect(report.percentage).toBe(100)
    expect(report.summary.easy.passed).toBe(50)
    expect(report.summary.medium.passed).toBe(30)
    expect(report.summary.hard.passed).toBe(15)
    expect(report.summary.hell.passed).toBe(5)
    expect(report.qualityModifiers.totalModifier).toBe(20)
  })
})

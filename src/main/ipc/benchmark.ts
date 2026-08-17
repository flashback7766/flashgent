import { BrowserWindow } from 'electron'
import { DATASET_30_SCENARIOS } from '../../../tests/benchmark/datasets.js'
import { executeScenario } from '../../../tests/benchmark/runner.js'
import { CH } from '../../shared/ipc.js'
import type { BenchmarkProgress, BenchmarkReport, ScenarioResult } from '../../shared/types.js'
import { handle } from './result.js'

let running = false

function broadcast<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Runs benchmark scenarios directly; no Vitest runtime is loaded in Electron. */
export function registerBenchmarkHandlers(): void {
  handle<void, void>(CH.benchmarkRun, async () => {
    if (running) throw new Error('A benchmark run is already in progress.')
    running = true

    try {
      const scenarios: ScenarioResult[] = []
      const total = DATASET_30_SCENARIOS.length
      for (const [offset, scenario] of DATASET_30_SCENARIOS.entries()) {
        const result = await executeScenario(scenario)
        scenarios.push(result)
        const progress: BenchmarkProgress = {
          index: offset + 1,
          total,
          scenario: scenario.name,
          score: result.earnedPoints
        }
        broadcast(CH.evtBenchmarkProgress, progress)
      }

      const baseScore = scenarios.reduce((sum, scenario) => sum + scenario.earnedPoints, 0)
      const passed = scenarios.filter((scenario) => scenario.passed).length
      const qualityModifier = Math.round((passed / total) * 300) / 10
      const report: BenchmarkReport = {
        totalScore: Math.min(100, Math.round((baseScore + qualityModifier) * 10) / 10),
        maxScore: 100,
        scenarios
      }
      broadcast(CH.evtBenchmarkDone, { report })
    } finally {
      running = false
    }
  })
}

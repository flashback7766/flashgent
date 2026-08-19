import { BrowserWindow } from 'electron'
import { createLlmEvaluator, runBenchmark } from '../../../tests/benchmark/runner.js'
import { CH } from '../../shared/ipc.js'
import { readConfig } from '../configStore.js'
import { deleteBenchmarkRun, listBenchmarkRuns, saveBenchmarkRun } from '../db/index.js'
import { handle, handleN } from './result.js'
import type { BenchmarkRunRecord } from '../../shared/types.js'

let running = false

function broadcast<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Runs benchmark scenarios against live LM Studio model endpoint. */
export function registerBenchmarkHandlers(): void {
  handle<string | { model?: string; tier?: any; scenarioId?: string; concurrency?: number } | undefined, void>(CH.benchmarkRun, async (input) => {
    if (running) throw new Error('A benchmark run is already in progress.')
    running = true

    try {
      const opts = typeof input === 'string' ? { model: input } : input
      const config = readConfig()
      const endpoint =
        config.endpoints.find((e) => e.id === config.activeEndpointId) ?? config.endpoints[0]
      const baseUrl = endpoint?.baseUrl ?? 'http://localhost:1234/v1'
      const targetModel = opts?.model || config.lastModel || 'Local-LLM'

      const evaluator = createLlmEvaluator({
        baseUrl,
        modelName: targetModel
      })

      const report = await runBenchmark(targetModel, evaluator, (progress) => {
        broadcast(CH.evtBenchmarkProgress, progress)
      }, {
        tier: opts?.tier,
        scenarioId: opts?.scenarioId,
        concurrency: opts?.concurrency
      })

      // Persist run in database for historical leaderboards
      saveBenchmarkRun(report)

      broadcast(CH.evtBenchmarkDone, { report })
    } finally {
      running = false
    }
  })

  handleN<BenchmarkRunRecord[]>(CH.benchmarkList, async () => {
    return listBenchmarkRuns()
  })

  handleN<boolean>(CH.benchmarkDelete, async (id: string) => {
    return deleteBenchmarkRun(id)
  })
}

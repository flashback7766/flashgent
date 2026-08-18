import { BrowserWindow } from 'electron'
import { createLlmEvaluator, runBenchmark } from '../../../tests/benchmark/runner.js'
import { CH } from '../../shared/ipc.js'
import { readConfig } from '../configStore.js'
import { handle } from './result.js'

let running = false

function broadcast<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Runs benchmark scenarios against live LM Studio model endpoint. */
export function registerBenchmarkHandlers(): void {
  handle<string | undefined, void>(CH.benchmarkRun, async (modelName) => {
    if (running) throw new Error('A benchmark run is already in progress.')
    running = true

    try {
      const config = readConfig()
      const endpoint =
        config.endpoints.find((e) => e.id === config.activeEndpointId) ?? config.endpoints[0]
      const baseUrl = endpoint?.baseUrl ?? 'http://localhost:1234/v1'
      const targetModel = modelName || config.lastModel || 'Local-LLM'

      const evaluator = createLlmEvaluator({
        baseUrl,
        modelName: targetModel
      })

      const report = await runBenchmark(targetModel, evaluator, (progress) => {
        broadcast(CH.evtBenchmarkProgress, progress)
      })
      broadcast(CH.evtBenchmarkDone, { report })
    } finally {
      running = false
    }
  })
}

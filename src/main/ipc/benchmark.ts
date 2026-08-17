import { BrowserWindow } from 'electron'
import { runBenchmark } from '../../../tests/benchmark/runner.js'
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
  handle<string | undefined, void>(CH.benchmarkRun, async (modelName) => {
    if (running) throw new Error('A benchmark run is already in progress.')
    running = true

    try {
      const report = await runBenchmark(modelName, undefined, (progress) => {
        broadcast(CH.evtBenchmarkProgress, progress)
      })
      broadcast(CH.evtBenchmarkDone, { report })
    } finally {
      running = false
    }
  })
}

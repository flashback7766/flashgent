// Global worker instance for the renderer process.
// Initialized lazily to ensure it is "spawned once at agent session start".
let agentWorker: Worker | null = null

export function getAgentWorker(): Worker {
  if (!agentWorker) {
    agentWorker = new Worker(new URL('./agent.worker.ts', import.meta.url), { type: 'module' })
  }
  return agentWorker
}

/**
 * Shuts down the agent worker, to be called when an agent session ends to free resources.
 */
export function terminateAgentWorker(): void {
  if (agentWorker) {
    agentWorker.terminate()
    agentWorker = null
  }
}

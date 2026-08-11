import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // A local 30B model on an iGPU is slow to prefill; the agent test needs room.
  timeout: 20 * 60 * 1000,
  expect: { timeout: 15_000 },
  // Electron instances fight over the single-instance lock.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})


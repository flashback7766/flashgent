import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { findWorkingModel } from './models.js'

/**
 * The two paths the main suite does not reach: delegating to sub-agents at
 * Hypercode effort, and the clarification card. Both are slow — a Hypercode
 * turn reasons for thousands of tokens and then reviews itself — so they live
 * in their own file.
 */

const TURN_TIMEOUT_MS = 15 * 60 * 1000

let app: ElectronApplication
let page: Page
let workspace: string
let home: string

async function send(prompt: string): Promise<void> {
  const box = page.getByLabel('Message')
  await box.fill(prompt)
  await box.press('Control+Enter')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 60_000 })
}

async function waitForTurn(): Promise<void> {
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout: TURN_TIMEOUT_MS })
}

test.beforeAll(async () => {
  workspace = mkdtempSync(join(homedir(), '.flashgent-wf-'))
  home = mkdtempSync(join(tmpdir(), 'flashgent-wf-home-'))

  // Three unrelated files, so splitting the work is the obvious move.
  writeFileSync(join(workspace, 'alpha.md'), '# Alpha\n\nAlpha handles billing.\n', 'utf8')
  writeFileSync(join(workspace, 'beta.md'), '# Beta\n\nBeta handles shipping.\n', 'utf8')
  writeFileSync(join(workspace, 'gamma.md'), '# Gamma\n\nGamma handles refunds.\n', 'utf8')

  app = await electron.launch({
    args: [resolve('.'), workspace, `--user-data-dir=${join(home, 'userdata')}`],
    env: { ...process.env, FLASHGENT_HOME: home }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('#fg-model-picker')).toBeVisible({ timeout: 60_000 })

  const model = await findWorkingModel()
  test.skip(!model, 'No LM Studio model on this machine can be loaded.')

  if (model) {
    await page.locator('#fg-model-picker').click()
    const dialog = page.getByRole('dialog', { name: 'Model' })
    await dialog.getByRole('button', { name: model, exact: false }).first().click()
    await expect(dialog).toBeHidden()
  }
})

test.afterAll(async () => {
  await app?.close()
  rmSync(workspace, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test('Hypercode delegates to sub-agents and reviews its own work', async () => {
  // Top of the effort scale unlocks run_subtask and the review pass.
  await page.locator('#fg-effort').click()
  const effort = page.getByRole('dialog', { name: 'Effort' })
  await effort.getByRole('button', { name: 'Hypercode' }).click()
  await expect(page.locator('#fg-effort')).toContainText('Hypercode')
  await page.locator('#fg-effort').click()
  await expect(effort).toBeHidden()

  await send(
    'alpha.md, beta.md and gamma.md are unrelated. Delegate one subtask per file to read it, ' +
      'then tell me in one line what each of the three handles.'
  )
  await waitForTurn()

  // What flashgent owns: the tool is offered, it runs, and the sub-agent's
  // findings come back into the transcript.
  //
  // Deliberately not asserted: that the model fans out to three subtasks and
  // synthesises all three answers. A 24B model reliably dispatches one and
  // then improvises, and a test that fails on that is measuring the model,
  // not this app.
  const call = page.getByRole('button', { name: /run_subtask/ }).first()
  await expect(call).toBeVisible()

  await call.click()
  const result = page.locator('article').last()
  await expect(result).toContainText(/alpha|billing/i)
})

test('the clarification card collects an answer and the agent acts on it', async () => {
  // Back to a cheaper level: this test is about the card, not the reasoning.
  await page.locator('#fg-effort').click()
  const effort = page.getByRole('dialog', { name: 'Effort' })
  await effort.getByRole('button', { name: 'Medium' }).click()
  await page.locator('#fg-effort').click()
  await expect(effort).toBeHidden()

  await send(
    'Use the ask_user tool to ask me one question: should new files use tabs or spaces? ' +
      'Give exactly two options, "Tabs" and "Spaces". Do not do anything else first.'
  )

  const card = page.getByRole('dialog', { name: 'Clarification' })
  await expect(card).toBeVisible({ timeout: TURN_TIMEOUT_MS })

  // The stepper says which question we are on.
  await expect(card).toContainText('1/1')

  // Picking an option commits it and dismisses the card.
  await card.getByRole('button', { name: /Spaces/ }).first().click()
  await expect(card).toBeHidden()

  await waitForTurn()

  // The choice reached the model.
  await expect(page.locator('article').last()).toContainText(/spaces/i)
})

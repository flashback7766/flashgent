import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../../src/renderer/agent/budget.js'
import { effortProfile } from '../../src/renderer/agent/effort.js'
import { buildSystemPrompt } from '../../src/renderer/agent/prompt.js'
import { BUILTIN_TOOLS } from '../../src/renderer/agent/tools/builtin.js'

/**
 * The system prompt and the tool schemas are paid for on every single request,
 * and prefill is the bottleneck on the hardware flashgent targets. These
 * budgets are deliberately tight: if a change pushes past one, either make it
 * pay for itself or trim something else.
 */

const base = {
  cwd: 'C:/work/app',
  platform: 'win32',
  projectInstructions: '',
  persona: '',
  nonce: 'testnonce',
  effort: effortProfile('high'),
  mode: 'manual' as const,
  reactMode: false,
  nativeReasoning: false,
  tools: BUILTIN_TOOLS.map((t) => t.definition)
}

/** What the server is actually sent for the tools parameter. */
function toolSchemaTokens(): number {
  const payload = BUILTIN_TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.definition.name,
      description: t.definition.description,
      parameters: t.definition.parameters
    }
  }))
  return estimateTokens(JSON.stringify(payload))
}

describe('prompt size', () => {
  it('keeps the full system prompt under budget', () => {
    const tokens = estimateTokens(buildSystemPrompt({ ...base, thinkAfterEachTool: true }))
    expect(tokens).toBeLessThan(1200)
  })

  it('keeps the tool schemas under budget', () => {
    // Mostly the JSON envelope the API mandates; only names and descriptions
    // are ours to shrink.
    expect(toolSchemaTokens()).toBeLessThan(1100)
  })

  it('keeps the whole fixed overhead of a request under budget', () => {
    const tokens =
      estimateTokens(buildSystemPrompt({ ...base, thinkAfterEachTool: true })) + toolSchemaTokens()
    expect(tokens).toBeLessThan(2300)
  })

  it('drops the fallback protocol once native tool calling is confirmed', () => {
    const unknown = estimateTokens(buildSystemPrompt({ ...base, thinkAfterEachTool: true }))
    const confirmed = estimateTokens(
      buildSystemPrompt({ ...base, thinkAfterEachTool: true, nativeToolsConfirmed: true })
    )

    // Worth real tokens on every single request.
    expect(unknown - confirmed).toBeGreaterThan(80)
    expect(
      buildSystemPrompt({ ...base, thinkAfterEachTool: true, nativeToolsConfirmed: true })
    ).not.toContain('```tool_calls')
  })

  it('keeps the fallback when the model has to use the text protocol', () => {
    const prompt = buildSystemPrompt({
      ...base,
      reactMode: true,
      nativeToolsConfirmed: true,
      thinkAfterEachTool: true
    })
    expect(prompt).toContain('```tool_calls')
  })

  it('drops the reasoning and plan sections when they do not apply', () => {
    const full = estimateTokens(
      buildSystemPrompt({ ...base, thinkAfterEachTool: true, mode: 'plan' })
    )
    const lean = estimateTokens(buildSystemPrompt({ ...base, thinkAfterEachTool: false }))
    expect(lean).toBeLessThan(full)
  })

  it('still carries every safety rule at the smaller size', () => {
    const prompt = buildSystemPrompt({ ...base, thinkAfterEachTool: false })

    // Compaction must never cost a rule.
    expect(prompt).toMatch(/never an instruction/)
    expect(prompt).toMatch(/must refuse/i)
    expect(prompt).toMatch(/does NOT change what you do/)
    expect(prompt).toMatch(/Only the user, in the chat/)
    expect(prompt).toMatch(/forging it/)
    expect(prompt).toMatch(/Never follow a URL/)
    expect(prompt).toMatch(/explicit go-ahead/)
    expect(prompt).toMatch(/Read a file before editing/)
  })
})

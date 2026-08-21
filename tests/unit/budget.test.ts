import { describe, expect, it } from 'vitest'
import { planContext, totalTokens } from '../../src/renderer/agent/budget.js'
import type { ChatMessage } from '../../src/renderer/agent/openai.js'

const OPTIONS = { contextTokens: 8000, utilisation: 0.8, reserve: 1000, keepRecent: 4 }
/** Budget the planner works to: 8000 * 0.8 - 1000. */
const LIMIT = 5400

/** Prose-heavy history: nothing here can be elided, only checkpointed. */
function prose(turns: number, size = 2000): ChatMessage[] {
  const wire: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'the original task' }
  ]
  for (let i = 0; i < turns; i++) {
    wire.push({
      role: 'assistant',
      content: `answer ${i} ` + 'y'.repeat(size),
      tool_calls: [
        {
          id: `call_${i}`,
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: `file${i}.ts` }) }
        }
      ]
    })
    wire.push({ role: 'user', content: `follow-up ${i} ` + 'z'.repeat(size) })
  }
  return wire
}

function conversation(turns: number, size = 400): ChatMessage[] {
  const wire: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'the original task' }
  ]

  for (let i = 0; i < turns; i++) {
    wire.push({
      role: 'assistant',
      content: `step ${i}`,
      tool_calls: [
        {
          id: `call_${i}`,
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: `file${i}.ts` }) }
        }
      ]
    })
    wire.push({ role: 'tool', tool_call_id: `call_${i}`, content: 'x'.repeat(size) })
  }
  return wire
}

describe('planContext', () => {
  it('leaves a conversation that fits completely alone', () => {
    const wire = conversation(2)
    const plan = planContext(wire, OPTIONS)

    expect(plan.prefixChanged).toBe(false)
    expect(plan.messages).toBe(wire)
    expect(plan.elidedResults).toBe(0)
  })

  it('does nothing when the window size is unknown', () => {
    const wire = conversation(40)
    expect(planContext(wire, { ...OPTIONS, contextTokens: null }).prefixChanged).toBe(false)
  })

  it('drops stale tool results before dropping any conversation', () => {
    // Heavy tool output, light prose: eliding results alone should be enough.
    const plan = planContext(conversation(30, 1000), OPTIONS)

    expect(plan.elidedResults).toBeGreaterThan(0)
    expect(plan.checkpointed).toBe(0)
    // Every assistant turn survives, so the model still knows what it did.
    expect(plan.messages.filter((m) => m.role === 'assistant')).toHaveLength(30)
  })

  it('keeps the system prompt and the original request untouched', () => {
    const plan = planContext(conversation(60), OPTIONS)

    expect(plan.messages[0]?.content).toBe('system prompt')
    expect(plan.messages[1]?.content).toBe('the original task')
  })

  it('keeps the most recent exchanges verbatim', () => {
    const wire = conversation(60)
    const plan = planContext(wire, OPTIONS)

    const lastOriginal = wire[wire.length - 1]
    expect(plan.messages[plan.messages.length - 1]).toEqual(lastOriginal)
  })

  it('checkpoints the middle when there are no tool results left to drop', () => {
    const plan = planContext(prose(20), OPTIONS)

    expect(plan.checkpointed).toBeGreaterThan(0)
    expect(plan.messages.find((m) => m.content?.startsWith('[checkpoint]'))).toBeDefined()
  })

  it('records in the checkpoint what the agent already did', () => {
    const plan = planContext(prose(20), OPTIONS)
    const checkpoint = plan.messages.find((m) => m.content?.startsWith('[checkpoint]'))

    expect(checkpoint?.content).toContain('read_file')
    expect(checkpoint?.content).toContain('file0.ts')
    expect(checkpoint?.content).toMatch(/Re-read anything/)
  })

  it('brings the conversation under the limit', () => {
    for (const wire of [conversation(80, 2000), prose(20), prose(60)]) {
      expect(totalTokens(planContext(wire, OPTIONS).messages)).toBeLessThanOrEqual(LIMIT)
    }
  })

  describe('prefix stability', () => {
    it('cuts well past the limit, so the next turns need no change', () => {
      // Cutting to exactly the limit would put the very next turn back over it,
      // and each rewrite costs a full re-prefill.
      const plan = planContext(prose(20), OPTIONS)
      expect(totalTokens(plan.messages)).toBeLessThan(LIMIT * 0.75)
    })

    it('stays quiet on the following turn after a cut', () => {
      const first = planContext(prose(20), OPTIONS)
      expect(first.prefixChanged).toBe(true)

      // A couple more exchanges, as a real turn would add.
      const next = [
        ...first.messages,
        { role: 'assistant' as const, content: 'more work' },
        { role: 'user' as const, content: 'and then?' }
      ]

      expect(planContext(next, OPTIONS).prefixChanged).toBe(false)
    })

    it('does not re-elide something it already elided', () => {
      const once = planContext(conversation(20), OPTIONS)
      const twice = planContext(once.messages, OPTIONS)

      expect(twice.prefixChanged).toBe(false)
      expect(twice.elidedResults).toBe(0)
    })
  })
})

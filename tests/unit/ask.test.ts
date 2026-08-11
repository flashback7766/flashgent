import { describe, expect, it } from 'vitest'
import { createAskTool } from '../../src/renderer/agent/tools/ask.js'
import type { AskAnswer, AskRequest } from '../../src/shared/types.js'

const ctx = { cwd: '.', timeoutMs: 1000, maxOutputChars: 1000 }

/** Capture what the card would have been asked to render. */
function toolWithCapture(answers: AskAnswer[] = []) {
  let seen: AskRequest | null = null
  const tool = createAskTool(async (request) => {
    seen = request
    return answers.length
      ? answers
      : request.questions.map((q) => ({
          question: q.question,
          selected: [q.options[0]?.label ?? ''],
          other: '',
          skipped: false
        }))
  })
  return { tool, request: () => seen }
}

const wellFormed = {
  questions: [
    {
      header: 'Storage',
      question: 'Where should sessions live?',
      multiSelect: false,
      options: [
        { label: 'SQLite (Recommended)', description: 'Fast, queryable.' },
        { label: 'JSON files', description: 'Simpler, slower.' }
      ]
    }
  ]
}

describe('ask_user argument parsing', () => {
  it('accepts the documented shape', async () => {
    const { tool, request } = toolWithCapture()
    await tool.execute(wellFormed, ctx)

    expect(request()?.questions[0]?.question).toBe('Where should sessions live?')
    expect(request()?.questions[0]?.options).toHaveLength(2)
  })

  it.each([
    ['a single question object instead of an array', { questions: wellFormed.questions[0] }],
    ['the question at the top level', wellFormed.questions[0]],
    [
      'snake_case multi_select',
      { questions: [{ ...wellFormed.questions[0], multiSelect: undefined, multi_select: true }] }
    ],
    [
      '"choices" instead of "options"',
      {
        questions: [
          {
            question: 'Pick one',
            choices: [{ label: 'A' }, { label: 'B' }]
          }
        ]
      }
    ],
    [
      'plain strings as options',
      { questions: [{ question: 'Pick one', options: ['A', 'B'] }] }
    ],
    [
      '"text" instead of "question"',
      { questions: [{ text: 'Pick one', options: ['A', 'B'] }] }
    ],
    [
      '"name" instead of "label"',
      { questions: [{ question: 'Pick one', options: [{ name: 'A' }, { name: 'B' }] }] }
    ]
  ])('recovers from %s', async (_label, input) => {
    const { tool, request } = toolWithCapture()
    await tool.execute(input as Record<string, unknown>, ctx)

    expect(request()?.questions).toHaveLength(1)
    expect(request()?.questions[0]?.options.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps multi_select true when given in snake_case', async () => {
    const { tool, request } = toolWithCapture()
    await tool.execute(
      { questions: [{ question: 'Pick', multi_select: true, options: ['A', 'B'] }] },
      ctx
    )
    expect(request()?.questions[0]?.multiSelect).toBe(true)
  })

  it('rejects a question with fewer than two options, with a usable hint', async () => {
    const { tool } = toolWithCapture()

    await expect(
      tool.execute({ questions: [{ question: 'Pick', options: ['only one'] }] }, ctx)
    ).rejects.toThrow(/Send exactly this shape/)
  })

  it('rejects junk with the same hint rather than rendering an empty card', async () => {
    const { tool } = toolWithCapture()
    await expect(tool.execute({ questions: 'yes please' }, ctx)).rejects.toThrow(
      /at least two "options"/
    )
  })

  it('caps the card at four questions and four options', async () => {
    const { tool, request } = toolWithCapture()
    await tool.execute(
      {
        questions: Array.from({ length: 7 }, (_, i) => ({
          question: `Q${i}`,
          options: ['a', 'b', 'c', 'd', 'e', 'f']
        }))
      },
      ctx
    )

    expect(request()?.questions).toHaveLength(4)
    expect(request()?.questions[0]?.options).toHaveLength(4)
  })
})

describe('ask_user result', () => {
  it('reports the answers back in a form the model can act on', async () => {
    const { tool } = toolWithCapture([
      { question: 'Tabs or spaces?', selected: ['Spaces'], other: '', skipped: false }
    ])

    const result = await tool.execute(
      { questions: [{ question: 'Tabs or spaces?', options: ['Tabs', 'Spaces'] }] },
      ctx
    )

    expect(result.content).toContain('Tabs or spaces?')
    expect(result.content).toContain('Spaces')
    expect(result.ok).toBe(true)
  })

  it('says plainly when a question was skipped', async () => {
    const { tool } = toolWithCapture([
      { question: 'Tabs or spaces?', selected: [], other: '', skipped: true }
    ])

    const result = await tool.execute(
      { questions: [{ question: 'Tabs or spaces?', options: ['Tabs', 'Spaces'] }] },
      ctx
    )

    expect(result.content).toMatch(/skipped, decide for yourself/)
  })

  it('passes free text through alongside any picks', async () => {
    const { tool } = toolWithCapture([
      { question: 'Which?', selected: ['A'], other: 'actually C', skipped: false }
    ])

    const result = await tool.execute(
      { questions: [{ question: 'Which?', options: ['A', 'B'] }] },
      ctx
    )

    expect(result.content).toContain('actually C')
  })
})

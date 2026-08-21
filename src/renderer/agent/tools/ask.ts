import type { AskAnswer, AskQuestion, AskRequest, ToolResult } from '@shared/types'
import type { BuiltinTool } from './builtin.js'

/**
 * Asking the user, as a tool.
 *
 * A local model that guesses at an ambiguous requirement wastes far more of
 * the user's time than one that stops and asks — but only if asking is cheap
 * and structured. Free-text questions get free-text answers; a card with
 * options gets a decision.
 */
export type AskRunner = (request: AskRequest) => Promise<AskAnswer[]>

const MAX_QUESTIONS = 4
const MAX_OPTIONS = 4

/** First value present under any of `keys` that is a non-empty string. */
function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** First value present under any of `keys` that is an array. */
function pickArray(source: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source[key]
    if (Array.isArray(value)) return value
  }
  return []
}

/**
 * Coerce whatever the model produced into a card we can render.
 *
 * Small local models are inventive about the exact shape: a bare object
 * instead of an array, `text` for `question`, `choices` for `options`, plain
 * strings for options, snake_case keys. All of that is recoverable, and
 * recovering is far better than bouncing the call back.
 */
function parseQuestions(input: Record<string, unknown>): AskQuestion[] {
  // A single question, unwrapped, is the most common mistake.
  const container = Array.isArray(input.questions)
    ? input.questions
    : input.questions && typeof input.questions === 'object'
      ? [input.questions]
      : input.question || input.options
        ? [input]
        : []

  const questions: AskQuestion[] = []

  for (const candidate of container.slice(0, MAX_QUESTIONS)) {
    if (!candidate || typeof candidate !== 'object') continue
    const q = candidate as Record<string, unknown>

    const text = pickString(q, ['question', 'text', 'title', 'prompt'])
    if (!text) continue

    const options = pickArray(q, ['options', 'choices', 'answers'])
      .slice(0, MAX_OPTIONS)
      .map((option) => {
        if (typeof option === 'string') return { label: option, description: '' }
        if (!option || typeof option !== 'object') return { label: '', description: '' }
        const o = option as Record<string, unknown>
        return {
          label: pickString(o, ['label', 'name', 'title', 'value', 'option']),
          description: pickString(o, ['description', 'detail', 'hint', 'explanation'])
        }
      })
      .filter((o) => o.label)

    // A card with one option is not a choice.
    if (options.length < 2) continue

    questions.push({
      header: pickString(q, ['header', 'category', 'topic']).slice(0, 16) || 'Choose',
      question: text,
      multiSelect: q.multiSelect === true || q.multi_select === true || q.multiple === true,
      options
    })
  }

  return questions
}

/** Shown to the model when the call cannot be salvaged, so it can retry. */
const SHAPE_HINT =
  'ask_user could not read that. Send exactly this shape:\n' +
  '{"questions":[{"header":"Storage","question":"Where should sessions live?","multiSelect":false,' +
  '"options":[{"label":"SQLite (Recommended)","description":"Fast, queryable."},' +
  '{"label":"JSON files","description":"Simpler, slower."}]}]}\n' +
  'Every question needs "question" and at least two "options", each with a "label".'

function renderAnswers(answers: AskAnswer[]): string {
  return answers
    .map((answer) => {
      if (answer.skipped) return `${answer.question}\n  -> skipped, decide for yourself`
      const parts = [...answer.selected]
      if (answer.other.trim()) parts.push(answer.other.trim())
      return `${answer.question}\n  -> ${parts.join(' | ') || '(no answer)'}`
    })
    .join('\n\n')
}

export function createAskTool(run: AskRunner): BuiltinTool {
  return {
    definition: {
      name: 'ask_user',
      // Short prose, precise schema. The earlier version described the shape
      // only in prose and small models kept inventing their own; the example
      // below is what actually stopped that.
      description:
        'Ask the user to choose, when only they can decide. Never for something a tool could ' +
        'tell you. 1-4 questions, each with 2-4 options, recommendation first. Example: ' +
        '{"questions":[{"header":"Storage","question":"Where should sessions live?",' +
        '"multiSelect":false,"options":[{"label":"SQLite (Recommended)","description":"Fast, queryable."},' +
        '{"label":"JSON files","description":"Simpler, slower."}]}]}',
      // Nothing is touched, so this never needs a permission prompt of its own.
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: '1-4 questions to put to the user.',
            items: {
              type: 'object',
              properties: {
                header: {
                  type: 'string',
                  description: 'Two or three words naming the decision, e.g. "Storage".'
                },
                question: {
                  type: 'string',
                  description: 'The question itself, as a full sentence.'
                },
                multiSelect: {
                  type: 'boolean',
                  description: 'True when more than one option may be picked.'
                },
                options: {
                  type: 'array',
                  description:
                    '2-4 choices. Put your recommendation first, marked "(Recommended)".',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'Short name of the choice.' },
                      description: {
                        type: 'string',
                        description: 'One line on what it means or costs.'
                      }
                    },
                    required: ['label']
                  }
                }
              },
              required: ['question', 'options']
            }
          }
        },
        required: ['questions']
      }
    },

    async execute(input): Promise<ToolResult> {
      const questions = parseQuestions(input)
      if (!questions.length) throw new Error(SHAPE_HINT)

      const answers = await run({ questions })

      return {
        ok: true,
        content: `The user answered:\n\n${renderAnswers(answers)}\n\nProceed on that basis.`,
        display: { kind: 'list', title: questions[0]?.question ?? 'Question' }
      }
    }
  }
}

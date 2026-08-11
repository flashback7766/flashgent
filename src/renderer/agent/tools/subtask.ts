import type { ToolResult } from '@shared/types'
import type { BuiltinTool, ToolContext } from './builtin.js'

/**
 * Runs an independent piece of work in its own agent context.
 *
 * The point is context, not CPU: a subtask starts from an empty conversation,
 * so it can read as much as it needs without spending the parent's window.
 * Several may run at once — LM Studio serves them concurrently if its
 * "concurrent predictions" setting allows it, otherwise they simply queue.
 */
export type SubtaskRunner = (
  description: string,
  ctx: ToolContext,
  signal: AbortSignal
) => Promise<{ text: string; ok: boolean }>

export function createSubtaskTool(run: SubtaskRunner, signal: AbortSignal): BuiltinTool {
  return {
    definition: {
      name: 'run_subtask',
      description:
        'Delegate one self-contained investigation to a fresh agent with its own context. ' +
        'Emit every independent call in the SAME turn — they run in parallel; one per turn is ' +
        'pointless. It can read and search but not change anything, so gather findings with it ' +
        'and make the edits yourself.',
      // A subtask has nobody to ask, so anything needing permission is refused
      // inside it — it can read and report, never mutate. Gating the call
      // itself would only add a prompt that protects nothing.
      risk: 'read',
      concurrent: true,
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description:
              'The complete brief: the goal, the files or area involved, and exactly what to report back.'
          }
        },
        required: ['description']
      }
    },

    async execute(input, ctx): Promise<ToolResult> {
      const description = typeof input.description === 'string' ? input.description.trim() : ''
      if (!description) throw new Error('run_subtask needs a description.')

      const outcome = await run(description, ctx, signal)
      return {
        ok: outcome.ok,
        content: outcome.text || '(the subtask returned nothing)',
        display: { kind: 'plain', title: description.slice(0, 80) }
      }
    }
  }
}

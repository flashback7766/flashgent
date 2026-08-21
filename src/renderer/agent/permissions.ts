import type { PermissionMode, PermissionRules, ToolDefinition } from '@shared/types'

export type PermissionVerdict = 'auto-allow' | 'auto-deny' | 'ask'

export interface PermissionModeInfo {
  id: PermissionMode
  label: string
  description: string
}

export const PERMISSION_MODE_INFO: PermissionModeInfo[] = [
  { id: 'manual', label: 'Manual', description: 'Always ask before making changes' },
  { id: 'acceptEdits', label: 'Accept edits', description: 'Automatically accept all file edits' },
  { id: 'plan', label: 'Plan', description: 'Create a plan before making changes' },
  { id: 'auto', label: 'Auto', description: 'flashgent handles permission decisions' },
  { id: 'bypass', label: 'Bypass permissions', description: 'Accepts all permissions' }
]

/**
 * Commands that are hard to undo. In `auto` mode these are the only things
 * still worth interrupting the user for.
 */
const DESTRUCTIVE_COMMAND = new RegExp(
  [
    '\\brm\\s+-[a-z]*[rf]', // rm -rf
    '\\bremove-item\\b.*-recurse',
    '\\brmdir\\b',
    '\\bdel\\s+/[sq]',
    '\\bformat\\b',
    '\\bmkfs\\b',
    '\\bdd\\s+if=',
    '\\bgit\\s+push\\b.*(--force|-f\\b)',
    '\\bgit\\s+reset\\s+--hard',
    '\\bgit\\s+clean\\s+-[a-z]*f',
    '\\bnpm\\s+publish',
    '\\bdocker\\s+(system\\s+prune|rm\\s+-f)',
    '\\bshutdown\\b',
    '\\breboot\\b',
    '\\bcurl\\b[^|]*\\|\\s*(ba)?sh', // curl … | sh
    '\\biwr\\b[^|]*\\|\\s*iex',
    '\\bsudo\\b'
  ].join('|'),
  'i'
)

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND.test(command)
}

/** Tools a mode refuses to expose at all. Plan mode is read-only. */
export function toolAllowedInMode(definition: ToolDefinition, mode: PermissionMode): boolean {
  if (mode !== 'plan') return true
  return definition.risk === 'read'
}

/**
 * Rules match either a bare tool name (`write_file`) or, for the shell, a
 * command prefix (`shell:npm run`). Prefix rules let a user green-light
 * `npm test` without handing over the whole shell.
 */
export function evaluatePermission(
  definition: ToolDefinition,
  input: Record<string, unknown>,
  rules: PermissionRules,
  mode: PermissionMode = 'manual'
): PermissionVerdict {
  const keys = ruleKeysFor(definition, input)

  // An explicit deny outranks everything, including bypass: it is the one
  // instruction the user gave about this specific tool.
  if (rules.deny.some((rule) => keys.some((key) => matches(rule, key)))) return 'auto-deny'

  // Plan mode should never see a mutating tool, but if one slips through the
  // registry filter, refuse it rather than run it.
  if (mode === 'plan' && definition.risk !== 'read') return 'auto-deny'

  if (mode === 'bypass') return 'auto-allow'

  // Reads are cheap and reversible, so they never interrupt the user.
  if (definition.risk === 'read') return 'auto-allow'

  if (rules.allow.some((rule) => keys.some((key) => matches(rule, key)))) return 'auto-allow'

  if (mode === 'acceptEdits' && definition.risk === 'write') return 'auto-allow'

  if (mode === 'auto') {
    const command = typeof input.command === 'string' ? input.command : ''
    return command && isDestructiveCommand(command) ? 'ask' : 'auto-allow'
  }

  return 'ask'
}

/** The rule strings that would cover this specific invocation. */
export function ruleKeysFor(definition: ToolDefinition, input: Record<string, unknown>): string[] {
  const keys = [definition.name]
  if (definition.name === 'run_shell' && typeof input.command === 'string') {
    keys.push(`shell:${input.command.trim()}`)
  }
  return keys
}

/** A rule covers a key if it is equal to it, or is a prefix of a shell command. */
function matches(rule: string, key: string): boolean {
  if (rule === key) return true
  if (rule.startsWith('shell:') && key.startsWith('shell:')) {
    return key.slice(6).startsWith(rule.slice(6))
  }
  return false
}

/** The rule we should persist when the user picks "Always". */
export function persistableRule(
  definition: ToolDefinition,
  input: Record<string, unknown>
): string {
  if (definition.name === 'run_shell' && typeof input.command === 'string') {
    // Store the first two words, so "npm test" generalises but "rm -rf /" does
    // not silently authorise every future rm.
    const words = input.command.trim().split(/\s+/).slice(0, 2).join(' ')
    return `shell:${words}`
  }
  return definition.name
}

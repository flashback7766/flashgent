import type { EffortLevel, ModelPreset } from '@shared/types'

/**
 * Effort, made concrete.
 *
 * A local model served by LM Studio has no native effort control, so one
 * slider drives several things at once: how long the agent is asked to reason,
 * how many tool steps it may take, how much output it may produce, and how
 * deterministic its sampling is. `reasoning_effort` is also sent, for the
 * servers that understand it — the client drops the field and retries if the
 * server rejects it.
 */
export interface EffortProfile {
  level: EffortLevel
  label: string
  /** Rough target for reasoning length, in tokens. 0 means "do not force it". */
  thinkingBudget: number
  /** Tool-calling steps allowed before the agent stops to ask. */
  maxIterations: number
  /** Added to the preset temperature; higher effort samples more tightly. */
  temperatureDelta: number
  /** Ceiling on completion tokens for one turn. */
  maxTokens: number
  /**
   * Value for the OpenAI-style `reasoning_effort` parameter.
   *
   * `off` is not an OpenAI value, but LM Studio accepts it for models whose
   * reasoning is a plain on/off switch — and that is exactly what the lowest
   * effort level wants. A server that rejects it makes the client drop the
   * parameter and retry, so nothing is lost.
   */
  reasoningEffort: 'off' | 'low' | 'medium' | 'high' | null
  /** Sentence injected into the system prompt. */
  guidance: string
  /** Unlocks the sub-agent tool and the review pass. */
  workflows: boolean
  /** How many sub-agents may run at once. */
  maxParallelSubtasks: number
}

const PROFILES: Record<EffortLevel, EffortProfile> = {
  minimal: {
    level: 'minimal',
    label: 'Minimal',
    thinkingBudget: 0,
    maxIterations: 4,
    temperatureDelta: 0.15,
    maxTokens: 1024,
    // Minimal means minimal: switch reasoning off where the server can.
    reasoningEffort: 'off',
    workflows: false,
    maxParallelSubtasks: 0,
    guidance:
      'Answer directly. Do not reason step by step unless the question cannot be answered without it. Prefer one tool call over three.'
  },
  low: {
    level: 'low',
    label: 'Low',
    thinkingBudget: 200,
    maxIterations: 8,
    temperatureDelta: 0.1,
    maxTokens: 2048,
    reasoningEffort: 'low',
    workflows: false,
    maxParallelSubtasks: 0,
    guidance: 'Keep reasoning to a sentence or two. Favour the direct route over the thorough one.'
  },
  medium: {
    level: 'medium',
    label: 'Medium',
    thinkingBudget: 500,
    maxIterations: 15,
    temperatureDelta: 0,
    maxTokens: 3072,
    reasoningEffort: 'medium',
    workflows: false,
    maxParallelSubtasks: 0,
    guidance: 'Think before acting, but keep it short. Verify anything you are not sure about.'
  },
  high: {
    level: 'high',
    label: 'High',
    thinkingBudget: 1000,
    maxIterations: 25,
    temperatureDelta: -0.05,
    maxTokens: 4096,
    reasoningEffort: 'high',
    workflows: false,
    maxParallelSubtasks: 0,
    guidance:
      'Think the problem through before acting. Check your assumptions against the actual files rather than guessing, and say what you verified.'
  },
  xhigh: {
    level: 'xhigh',
    label: 'Very high',
    thinkingBudget: 2000,
    maxIterations: 40,
    temperatureDelta: -0.1,
    maxTokens: 6144,
    reasoningEffort: 'high',
    workflows: false,
    maxParallelSubtasks: 0,
    guidance:
      'Reason carefully and consider more than one approach before committing. Read the surrounding code before editing it. Prefer being right over being quick.'
  },
  max: {
    level: 'max',
    label: 'Maximum',
    thinkingBudget: 4000,
    maxIterations: 60,
    temperatureDelta: -0.15,
    maxTokens: 8192,
    reasoningEffort: 'high',
    workflows: false,
    maxParallelSubtasks: 0,
    guidance:
      'Be exhaustive. Enumerate the plausible approaches, weigh them, and pick one with a reason. Verify every claim against the code before stating it, and check edge cases you would normally skip.'
  },
  hypercode: {
    level: 'hypercode',
    label: 'Hypercode',
    thinkingBudget: 6000,
    maxIterations: 100,
    temperatureDelta: -0.2,
    maxTokens: 8192,
    reasoningEffort: 'high',
    workflows: true,
    maxParallelSubtasks: 10,
    guidance:
      'Maximum effort. When a task has independent parts, emit one run_subtask call per part in a SINGLE turn — they run together, and one call at a time wastes the whole point. Do not read those files yourself afterwards; the subtasks already did. Then review your work against the original request and fix what you find. Thorough beats fast here; the user chose this deliberately.'
  }
}

/** Levels that unlock the workflow machinery. */
export function hasWorkflows(level: EffortLevel): boolean {
  return effortProfile(level).workflows
}

export function effortProfile(level: EffortLevel): EffortProfile {
  return PROFILES[level] ?? PROFILES.high
}

/**
 * Apply the effort profile on top of the user's preset.
 *
 * `max_tokens` covers reasoning *and* the reply — a reasoning model that
 * thinks for the whole budget returns an empty message with
 * `finish_reason: "length"`. So the request asks for the reply cap plus the
 * reasoning budget, with slack, and the reply cap stays what the user sees.
 */
export function applyEffort(preset: ModelPreset, level: EffortLevel): ModelPreset {
  const profile = effortProfile(level)
  // The preset stays the ceiling for the reply itself: effort must not
  // silently exceed what the user configured for the model.
  const replyCap = Math.min(preset.maxTokens, profile.maxTokens)

  return {
    ...preset,
    temperature: clamp(preset.temperature + profile.temperatureDelta, 0, 2),
    maxTokens: replyCap + Math.ceil(profile.thinkingBudget * 1.5)
  }
}

/** Tokens the reply itself may use, before reasoning headroom is added. */
export function replyCapFor(preset: ModelPreset, level: EffortLevel): number {
  return Math.min(preset.maxTokens, effortProfile(level).maxTokens)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Prefill progress, estimated.
 *
 * No OpenAI-compatible server reports how far it is through reading a prompt,
 * so there is nothing to display directly. What we can do is measure: every
 * completed request tells us how many prompt tokens were processed and how
 * long the wait before the first token was. That gives a tokens-per-second
 * figure for this machine and model, and the next request's progress is the
 * elapsed time against the time that rate predicts.
 *
 * It is an estimate and is treated as one — it never claims to be finished,
 * and a model with no measurement yet simply shows no percentage.
 */

const STORAGE_KEY = 'flashgent.prefillRate'
/** Weight of the newest sample; the rest is the running average. */
const SMOOTHING = 0.3
/** Below this, a sample is noise rather than a measurement. */
const MIN_SAMPLE_TOKENS = 200
const MIN_SAMPLE_MS = 250

/**
 * Starting guess, so the bar is there on the very first message instead of
 * appearing only once something has been measured. Taken from a small MoE
 * model on an integrated GPU; the real rate replaces it after one request.
 */
const SEED_RATE = 220

/**
 * Progress is shown against half the real rate, so the bar always runs 2x
 * slower than the truth and finishes early. The alternative — an optimistic
 * estimate — parks at 99% and reads as a hang, which is exactly the anxiety
 * the bar exists to remove.
 */
const DISPLAY_SLOWDOWN = 0.5

/**
 * Per-request cost that has nothing to do with prompt length: queueing,
 * sampler setup, the first token itself. Without it a short prompt would be
 * predicted to finish in milliseconds and the bar would jump straight to 99%.
 */
const OVERHEAD_MS = 400

type RateTable = Record<string, number>

function load(): RateTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RateTable) : {}
  } catch {
    return {}
  }
}

function save(table: RateTable): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table))
  } catch {
    // Storage being unavailable only costs us the estimate.
  }
}

/** Measured tokens per second for this model, or null if never measured. */
export function measuredRate(model: string): number | null {
  const rate = load()[model]
  return typeof rate === 'number' && rate > 0 ? rate : null
}

/** Rate to plan against: what was measured, or the starting guess. */
export function prefillRate(model: string): number {
  return measuredRate(model) ?? SEED_RATE
}

/** Fold one observation into the running average for a model. */
export function recordPrefill(model: string, promptTokens: number, elapsedMs: number): void {
  if (promptTokens < MIN_SAMPLE_TOKENS || elapsedMs < MIN_SAMPLE_MS) return

  // Learn throughput, not throughput-plus-overhead, or the rate would look
  // worse on short prompts than the hardware actually is.
  const working = Math.max(1, elapsedMs - OVERHEAD_MS)
  const sample = promptTokens / (working / 1000)
  if (!Number.isFinite(sample) || sample <= 0) return

  const table = load()
  const previous = table[model]
  table[model] =
    typeof previous === 'number' && previous > 0
      ? previous * (1 - SMOOTHING) + sample * SMOOTHING
      : sample

  save(table)
}

export interface PrefillProgress {
  /** 0-99, or null when there is no measurement to base it on. */
  percent: number | null
  /** Seconds still expected, or null. */
  remainingSeconds: number | null
}

export function prefillProgress(
  model: string,
  promptTokens: number,
  elapsedMs: number
): PrefillProgress {
  if (promptTokens <= 0) return { percent: null, remainingSeconds: null }

  const rate = prefillRate(model) * DISPLAY_SLOWDOWN
  const expectedMs = OVERHEAD_MS + (promptTokens / rate) * 1000
  // Never reach 100: the request is not done until a token actually arrives,
  // and a bar that sits full is worse than one that sits at 99.
  const percent = Math.min(99, Math.floor((elapsedMs / expectedMs) * 100))

  return {
    percent: Math.max(0, percent),
    remainingSeconds: Math.max(0, Math.round((expectedMs - elapsedMs) / 1000))
  }
}

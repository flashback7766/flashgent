/**
 * Choosing a model for the e2e suite.
 *
 * Not a spec file on purpose: importing one from another would register its
 * tests twice.
 */

const BASE_URL = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1'

/**
 * Preference order for the suite, best first.
 *
 * Measured on this machine: GLM-4.7-Flash reasons natively and is the stronger
 * agent, but a full run takes ~45 minutes because it thinks through every
 * turn. LFM2-24B finishes the same suite in ~3 minutes and is accurate enough
 * for regression testing. Set FLASHGENT_TEST_MODEL to pin one explicitly.
 */
const PREFERRED = [/glm/i, /lfm2/i]

const PINNED = process.env.FLASHGENT_TEST_MODEL

/** Preferred models first, in order, then everything else. */
export function byPreference(ids: string[]): string[] {
  const rank = (id: string): number => {
    const index = PREFERRED.findIndex((pattern) => pattern.test(id))
    return index === -1 ? PREFERRED.length : index
  }
  return [...ids].sort((a, b) => rank(a) - rank(b))
}

/**
 * Not every model LM Studio lists can actually be loaded — some crash the
 * runtime. Probe them in preference order so the suite reports on flashgent
 * rather than on the local model zoo.
 */
export async function findWorkingModel(): Promise<string | null> {
  const listing = await fetch(`${BASE_URL}/models`)
  const body = (await listing.json()) as { data?: Array<{ id: string }> }
  const all = (body.data ?? []).map((m) => m.id).filter((id) => !/embed/i.test(id))
  const ids = PINNED ? all.filter((id) => id.includes(PINNED)) : all

  for (const id of byPreference(ids)) {
    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: id,
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          max_tokens: 16
        }),
        signal: AbortSignal.timeout(300_000)
      })
      if (response.ok) return id
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

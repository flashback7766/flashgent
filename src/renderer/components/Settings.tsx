import type { AppConfig, McpServerConfig } from '@shared/types'
import { useEffect, useState } from 'react'
import { formatTokens } from '../lib/format.js'
import { useApp } from '../store/app.js'

type Tab = 'general' | 'models' | 'tools' | 'appearance' | 'keys' | 'benchmark' | 'about'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'tools', label: 'Tools & Permissions' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'keys', label: 'Keybindings' },
  { id: 'benchmark', label: 'Benchmark' },
  { id: 'about', label: 'About' }
]

const inputClass =
  'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line pb-5 last:border-0">
      <h3 className="pt-5 pb-1 text-[13px] font-medium text-ink">{title}</h3>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block py-2.5">
      <span className="block text-[12.5px] text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-[11.5px] text-faint">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

/** Label + description on the left, switch on the right. */
function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand' : 'bg-line'
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

/** Segmented control, for the small closed sets. */
function Segmented<T extends string>({
  label,
  hint,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{hint}</div>}
      </div>
      <div className="flex shrink-0 gap-0.5 rounded-md bg-raised p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={`rounded px-2.5 py-1 text-[11.5px] ${
              value === option.id ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function RuleList({
  title,
  rules,
  onChange,
  tone
}: {
  title: string
  rules: string[]
  onChange: (next: string[]) => void
  tone: 'ok' | 'bad'
}) {
  const [draft, setDraft] = useState('')

  return (
    <div className="py-2.5">
      <span className="text-[12.5px] text-ink">{title}</span>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {rules.length === 0 && <li className="text-[11.5px] text-faint">Nothing yet.</li>}
        {rules.map((rule) => (
          <li
            key={rule}
            className={`flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11.5px] ${
              tone === 'ok' ? 'border-ok/40 text-ok' : 'border-bad/40 text-bad'
            }`}
          >
            {rule}
            <button
              type="button"
              onClick={() => onChange(rules.filter((r) => r !== rule))}
              aria-label={`Remove ${rule}`}
              className="text-faint hover:text-ink"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="write_file or shell:npm test"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => {
            const rule = draft.trim()
            if (rule && !rules.includes(rule)) onChange([...rules, rule])
            setDraft('')
          }}
          className="shrink-0 rounded-md border border-line px-3 text-[12px] text-muted hover:bg-raised hover:text-ink"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function McpEditor({
  servers,
  onChange
}: {
  servers: McpServerConfig[]
  onChange: (next: McpServerConfig[]) => void
}) {
  const statuses = useApp((s) => s.mcpStatuses)
  const update = (id: string, patch: Partial<McpServerConfig>): void =>
    onChange(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  return (
    <div className="py-2.5">
      <span className="text-[12.5px] text-ink">MCP servers</span>
      <p className="mt-0.5 text-[11.5px] text-faint">
        Extra tools from Model Context Protocol servers, exposed to the agent as
        <span className="font-mono"> server__tool</span>.
      </p>

      <div className="mt-2 space-y-2">
        {servers.map((server) => {
          const status = statuses.find((s) => s.id === server.id)
          return (
            <div key={server.id} className="rounded-md border border-line p-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={(e) => update(server.id, { enabled: e.target.checked })}
                  aria-label={`Enable ${server.name}`}
                />
                <input
                  value={server.name}
                  onChange={(e) => update(server.id, { name: e.target.value })}
                  className="flex-1 rounded border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-brand"
                />
                <select
                  value={server.transport}
                  onChange={(e) =>
                    update(server.id, { transport: e.target.value as McpServerConfig['transport'] })
                  }
                  className="rounded border border-line bg-canvas px-1.5 py-1 text-[11.5px] outline-none"
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                  <option value="http">http</option>
                  <option value="ws">ws</option>
                </select>
                <button
                  type="button"
                  onClick={() => onChange(servers.filter((s) => s.id !== server.id))}
                  aria-label={`Remove ${server.name}`}
                  className="px-1 text-faint hover:text-bad"
                >
                  &times;
                </button>
              </div>

              {server.transport === 'stdio' ? (
                <div className="mt-2 flex gap-2">
                  <input
                    value={server.command ?? ''}
                    onChange={(e) => update(server.id, { command: e.target.value })}
                    placeholder="npx"
                    className="w-32 rounded border border-line bg-canvas px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand"
                  />
                  <input
                    value={(server.args ?? []).join(' ')}
                    onChange={(e) =>
                      update(server.id, { args: e.target.value.split(' ').filter(Boolean) })
                    }
                    placeholder="-y @modelcontextprotocol/server-filesystem ."
                    className="flex-1 rounded border border-line bg-canvas px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand"
                  />
                </div>
              ) : (
                <input
                  value={server.url ?? ''}
                  onChange={(e) => update(server.id, { url: e.target.value })}
                  placeholder="http://localhost:3000/mcp"
                  className="mt-2 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-[11.5px] outline-none focus:border-brand"
                />
              )}

              {status && (
                <p
                  className={`mt-1.5 text-[11px] ${status.connected ? 'text-ok' : status.error ? 'text-bad' : 'text-faint'}`}
                >
                  {status.connected
                    ? `connected · ${status.toolCount} tools`
                    : (status.error ?? 'not connected')}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() =>
          onChange([
            ...servers,
            {
              id: globalThis.crypto.randomUUID(),
              name: 'New server',
              enabled: false,
              transport: 'stdio',
              command: '',
              args: []
            }
          ])
        }
        className="mt-2 rounded-md border border-line px-3 py-1 text-[12px] text-muted hover:bg-raised hover:text-ink"
      >
        Add server
      </button>
    </div>
  )
}

/** Live preview of the code styling, so the font choice is visible. */
function CodePreview({ font }: { font: string }) {
  return (
    <pre
      className="mt-2 overflow-x-auto rounded-md border border-line bg-raised p-3 text-[12px] leading-relaxed"
      style={font.trim() ? { fontFamily: `${font}, var(--font-mono)` } : undefined}
    >
      <code className="hljs">
        <span className="hljs-keyword">function</span>{' '}
        <span className="hljs-title">greet</span>(<span className="hljs-attr">name</span>:{' '}
        <span className="hljs-type">string</span>) {'{'}
        {'\n  '}
        <span className="hljs-keyword">return</span>{' '}
        <span className="hljs-string">{'`Hello, ${name}!`'}</span>;{'\n'}
        {'}'}
      </code>
    </pre>
  )
}

function BenchmarkPanel({
  running,
  progress,
  modelTokensPerSecond,
  report,
  onRun
}: {
  running: boolean
  progress: { index: number; total: number; scenario: string; score: number } | null
  modelTokensPerSecond: number | null
  report: {
    totalScore: number
    maxScore: number
    scenarios: Array<{ tier: 'easy' | 'medium' | 'hard'; earnedPoints: number; maxPoints: number; passed: boolean }>
  } | null
  onRun: (model?: string) => void
}) {
  const models = useApp((s) => s.models)
  const config = useApp((s) => s.config)
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    config?.lastModel ?? models[0]?.id ?? undefined
  )
  const categories = [
    { tier: 'easy' as const, label: 'Easy' },
    { tier: 'medium' as const, label: 'Medium' },
    { tier: 'hard' as const, label: 'Hard' }
  ]
  const percent = progress ? Math.round((progress.index / progress.total) * 100) : 0

  return (
    <>
      <Section title="Agent benchmark">
        <p className="text-[12.5px] leading-relaxed text-muted">
          Run all 30 isolated scenarios to check Flashgent&apos;s tool workflow baseline.
        </p>
          <div className="mt-3 flex items-center gap-3">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value || undefined)}
              className="rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink"
            >
              <option value="">(Default)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>

        <button
          type="button"
          disabled={running}
            onClick={() => onRun(selectedModel)}
          className="mt-4 rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Running Benchmark…' : 'Run Benchmark'}
        </button>
          </div>
        {progress && (
          <div className="mt-4 rounded-lg border border-line bg-canvas p-3">
            <div className="flex justify-between gap-3 text-[11.5px] text-muted">
              <span className="truncate">{progress.scenario}</span>
              <span className="shrink-0">{progress.index}/{progress.total}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-brand transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </Section>

      {report && (
        <Section title="Latest result">
          <div className="rounded-xl border border-brand/40 bg-brand/10 px-5 py-4 text-center">
            <div className="text-4xl font-semibold tracking-tight text-ink">
              {report.totalScore}/{report.maxScore}
            </div>
            <div className="mt-1 text-[11.5px] uppercase tracking-wider text-muted">Benchmark score</div>
          </div>
          {modelTokensPerSecond !== null && (
            <div className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-muted">
              Last measured model throughput:{' '}
              <span className="font-mono text-ink">
                {modelTokensPerSecond >= 100
                  ? Math.round(modelTokensPerSecond)
                  : modelTokensPerSecond.toFixed(1)} tok/s
              </span>
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-raised text-[11px] uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Passed</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(({ tier, label }) => {
                  const items = report.scenarios.filter((scenario) => scenario.tier === tier)
                  const score = items.reduce((sum, scenario) => sum + scenario.earnedPoints, 0)
                  const max = items.reduce((sum, scenario) => sum + scenario.maxPoints, 0)
                  const passed = items.filter((scenario) => scenario.passed).length
                  return (
                    <tr key={tier} className="border-t border-line text-muted">
                      <td className="px-3 py-2.5 font-medium text-ink">{label}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{score}/{max}</td>
                      <td className="px-3 py-2.5 text-right">{passed}/{items.length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  )
}
export function Settings(): React.ReactElement | null {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const config = useApp((s) => s.config)
  const saveConfig = useApp((s) => s.saveConfig)
  const refreshModels = useApp((s) => s.refreshModels)
  const warmUpModel = useApp((s) => s.warmUpModel)
  const connection = useApp((s) => s.connection)
  const connectionError = useApp((s) => s.connectionError)
  const models = useApp((s) => s.models)
  const info = useApp((s) => s.info)
  const updateInfo = useApp((s) => s.updateInfo)
  const updateProgress = useApp((s) => s.updateProgress)
  const checkForUpdates = useApp((s) => s.checkForUpdates)
  const downloadUpdate = useApp((s) => s.downloadUpdate)
  const installUpdate = useApp((s) => s.installUpdate)
  const benchmarkRunning = useApp((s) => s.benchmarkRunning)
  const benchmarkProgress = useApp((s) => s.benchmarkProgress)
  const benchmarkReport = useApp((s) => s.benchmarkReport)
  const runBenchmark = useApp((s) => s.runBenchmark)
  const modelTokensPerSecond = useApp((s) => {
    const latest = [...s.messages].reverse().find(
      (message) => message.role === 'assistant' && message.usage && message.generationMs
    )
    return latest?.usage && latest.generationMs
      ? latest.usage.completion / (latest.generationMs / 1000)
      : null
  })
  const [tab, setTab] = useState<Tab>('general')
  const [draft, setDraft] = useState<AppConfig | null>(config)

  useEffect(() => {
    if (open) setDraft(config)
  }, [open, config])

  if (!open || !draft || !config) return null

  const patch = (partial: Partial<AppConfig>): void => setDraft({ ...draft, ...partial })
  const patchAgent = (partial: Partial<AppConfig['agent']>): void =>
    patch({ agent: { ...draft.agent, ...partial } })
  const patchLook = (partial: Partial<AppConfig['appearance']>): void =>
    patch({ appearance: { ...draft.appearance, ...partial } })

  const save = async (): Promise<void> => {
    await saveConfig(draft)
    setOpen(false)
  }

  const activeEndpoint =
    draft.endpoints.find((e) => e.id === draft.activeEndpointId) ?? draft.endpoints[0]
  const activePreset = draft.presets.find((p) => p.id === draft.activePresetId) ?? draft.presets[0]

  return (
    <div
      className="fg-fade fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        className="fg-rise flex h-full max-h-[44rem] w-full max-w-4xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        role="dialog"
        aria-label="Settings"
      >
        <nav className="w-48 shrink-0 border-r border-line p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${
                tab === t.id ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line px-6 py-3">
            <h2 className="text-[13.5px] font-medium text-ink">
              {TABS.find((t) => t.id === tab)?.label}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close settings"
              className="text-[16px] leading-none text-faint hover:text-ink"
            >
              &times;
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6">
            {tab === 'general' && (
              <>
                <Section title="Agent">
                  <Toggle
                    label="Reason after every tool result"
                    hint="The agent stops to think about what a tool returned before acting again. Slower, but it catches far more mistakes on a local model."
                    checked={draft.agent.thinkAfterEachTool}
                    onChange={(v) => patchAgent({ thinkAfterEachTool: v })}
                  />
                  <Toggle
                    label="Run independent reads in parallel"
                    hint="Several file reads or searches in one turn go out together instead of one after another."
                    checked={draft.agent.parallelTools}
                    onChange={(v) => patchAgent({ parallelTools: v })}
                  />
                  <Field
                    label="Agent instructions"
                    hint="Appended to every system prompt. Good place for language and style preferences."
                  >
                    <textarea
                      value={draft.agent.persona}
                      onChange={(e) => patchAgent({ persona: e.target.value })}
                      rows={3}
                      placeholder="Answer in Russian. Prefer small commits."
                      className={`${inputClass} resize-y`}
                    />
                  </Field>
                </Section>

                <Section title="Performance">
                  <p className="pb-1 text-[11.5px] leading-relaxed text-faint">
                    On an integrated GPU, prefill dominates. Every one of these trades thoroughness
                    for a shorter prompt.
                  </p>
                  <Field
                    label="Tool output limit"
                    hint="Characters of a tool's output that reach the model. Lower keeps long shell output from flooding the window."
                  >
                    <input
                      type="number"
                      min="2000"
                      step="1000"
                      value={draft.agent.maxToolOutputChars}
                      onChange={(e) => patchAgent({ maxToolOutputChars: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label="Context utilisation"
                    hint="Share of the window the prompt may fill before older turns are trimmed."
                  >
                    <input
                      type="number"
                      min="0.3"
                      max="0.98"
                      step="0.01"
                      value={draft.agent.contextUtilisation}
                      onChange={(e) => patchAgent({ contextUtilisation: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label="Auto-compact at"
                    hint="Summarise the conversation once it fills this share of the window. 0 turns it off."
                  >
                    <input
                      type="number"
                      min="0"
                      max="0.99"
                      step="0.01"
                      value={draft.agent.autoCompactAt}
                      onChange={(e) => patchAgent({ autoCompactAt: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Tool timeout (ms)">
                    <input
                      type="number"
                      step="1000"
                      min="1000"
                      value={draft.agent.toolTimeoutMs}
                      onChange={(e) => patchAgent({ toolTimeoutMs: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label="Hard step ceiling"
                    hint="Absolute cap on tool steps, above whatever the effort level allows."
                  >
                    <input
                      type="number"
                      min="1"
                      value={draft.agent.maxIterations}
                      onChange={(e) => patchAgent({ maxIterations: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                </Section>

                <Section title="Privacy">
                  <Toggle
                    label="Share anonymous usage counts"
                    hint="Off by default. flashgent sends nothing today; this only sets your preference for if it ever does."
                    checked={draft.telemetryOptIn}
                    onChange={(v) => patch({ telemetryOptIn: v })}
                  />
                </Section>
              </>
            )}

            {tab === 'models' && activeEndpoint && activePreset && (
              <>
                <Section title="Server">
                  <Field
                    label="LM Studio endpoint"
                    hint="The OpenAI-compatible base URL, ending in /v1."
                  >
                    <div className="flex gap-2">
                      <input
                        value={activeEndpoint.baseUrl}
                        onChange={(e) =>
                          patch({
                            endpoints: draft.endpoints.map((x) =>
                              x.id === activeEndpoint.id ? { ...x, baseUrl: e.target.value } : x
                            )
                          })
                        }
                        className={`${inputClass} font-mono`}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await saveConfig(draft)
                          await refreshModels()
                        }}
                        className="shrink-0 rounded-md border border-line px-3 text-[12px] text-muted hover:bg-raised hover:text-ink"
                      >
                        Test
                      </button>
                    </div>
                    <p
                      className={`mt-1.5 text-[11.5px] ${
                        connection === 'ok'
                          ? 'text-ok'
                          : connection === 'error'
                            ? 'text-bad'
                            : 'text-faint'
                      }`}
                    >
                      {connection === 'ok'
                        ? `Connected · ${models.length} model${models.length === 1 ? '' : 's'}`
                        : connection === 'checking'
                          ? 'Checking...'
                          : (connectionError ?? 'Not tested yet.')}
                    </p>
                  </Field>
                </Section>

                <Section title="Available models">
                  <p className="pb-2 text-[11.5px] leading-relaxed text-faint">
                    LM Studio loads a model on first use, which can take minutes. Warm one up here
                    so the first real message is not the one that waits.
                  </p>
                  <ul className="space-y-1">
                    {models.length === 0 && (
                      <li className="py-2 text-[11.5px] text-faint">
                        No models. Start the LM Studio server and press Test.
                      </li>
                    )}
                    {models.map((model) => (
                      <li
                        key={model.id}
                        className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2"
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${model.loaded ? 'bg-ok' : 'bg-faint'}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                          {model.id}
                        </span>
                        {model.contextLength && (
                          <span className="shrink-0 text-[11px] text-faint">
                            {formatTokens(model.contextLength)} ctx
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={model.loaded}
                          onClick={() => void warmUpModel(model.id)}
                          className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-ink disabled:opacity-40"
                        >
                          {model.loaded ? 'loaded' : 'warm up'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title="Sampling">
                  <Field
                    label="Preset"
                    hint="Effort adjusts these further; the preset is the baseline."
                  >
                    <select
                      value={draft.activePresetId}
                      onChange={(e) => patch({ activePresetId: e.target.value })}
                      className={inputClass}
                    >
                      {draft.presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Temperature">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="2"
                        value={activePreset.temperature}
                        onChange={(e) =>
                          patch({
                            presets: draft.presets.map((p) =>
                              p.id === activePreset.id
                                ? { ...p, temperature: Number(e.target.value) }
                                : p
                            )
                          })
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Max reply tokens">
                      <input
                        type="number"
                        step="256"
                        min="256"
                        value={activePreset.maxTokens}
                        onChange={(e) =>
                          patch({
                            presets: draft.presets.map((p) =>
                              p.id === activePreset.id
                                ? { ...p, maxTokens: Number(e.target.value) }
                                : p
                            )
                          })
                        }
                        className={inputClass}
                      />
                    </Field>
                  </div>

                  <Field
                    label="Context window override"
                    hint="Leave empty to use the size LM Studio reports for the loaded model."
                  >
                    <input
                      type="number"
                      value={draft.agent.contextTokensOverride ?? ''}
                      onChange={(e) =>
                        patchAgent({
                          contextTokensOverride: e.target.value ? Number(e.target.value) : null
                        })
                      }
                      className={inputClass}
                    />
                  </Field>
                </Section>
              </>
            )}

            {tab === 'tools' && (
              <>
                <Section title="Permissions">
                  <Toggle
                    label="Allow bypass permissions mode"
                    hint="Bypass skips every permission check and lets the agent work uninterrupted. Letting a model run arbitrary commands can lose data or damage the system, and a hostile file or web page can try to steer it. Off keeps the mode out of the picker entirely."
                    checked={draft.allowBypassMode}
                    onChange={(v) => patch({ allowBypassMode: v })}
                  />
                  <RuleList
                    title="Always allow"
                    tone="ok"
                    rules={draft.permissions.allow}
                    onChange={(allow) => patch({ permissions: { ...draft.permissions, allow } })}
                  />
                  <RuleList
                    title="Never allow"
                    tone="bad"
                    rules={draft.permissions.deny}
                    onChange={(deny) => patch({ permissions: { ...draft.permissions, deny } })}
                  />
                  <p className="pt-1 text-[11.5px] leading-relaxed text-faint">
                    A rule is a tool name (<span className="font-mono">write_file</span>) or a shell
                    prefix (<span className="font-mono">shell:npm test</span>). Deny always wins,
                    in every mode.
                  </p>
                </Section>

                <Section title="Extensions">
                  <McpEditor
                    servers={draft.mcpServers}
                    onChange={(mcpServers) => patch({ mcpServers })}
                  />
                </Section>
              </>
            )}

            {tab === 'appearance' && (
              <>
                <Section title="Theme">
                  <Segmented
                    label="Colour scheme"
                    value={draft.appearance.theme}
                    options={[
                      { id: 'system', label: 'System' },
                      { id: 'light', label: 'Light' },
                      { id: 'dark', label: 'Dark' }
                    ]}
                    onChange={(theme) => patchLook({ theme })}
                  />
                  <Toggle
                    label="High-contrast dark theme"
                    hint="Use a darker, near-black background when dark mode is on."
                    checked={draft.appearance.highContrast}
                    onChange={(v) => patchLook({ highContrast: v })}
                  />
                  <Field label="Accent colour">
                    <input
                      type="color"
                      value={draft.appearance.accent}
                      onChange={(e) => patchLook({ accent: e.target.value })}
                      className="h-8 w-24 rounded border border-line bg-canvas"
                    />
                  </Field>
                </Section>

                <Section title="Text">
                  <Segmented
                    label="Interface font"
                    hint="Font for menus, sidebar and chrome."
                    value={draft.appearance.interfaceFont}
                    options={[
                      { id: 'system', label: 'System' },
                      { id: 'sans', label: 'Inter' }
                    ]}
                    onChange={(interfaceFont) => patchLook({ interfaceFont })}
                  />
                  <Segmented
                    label="Transcript text size"
                    hint="Size of the conversation text."
                    value={draft.appearance.transcriptSize}
                    options={[
                      { id: 'small', label: 'Small' },
                      { id: 'medium', label: 'Medium' },
                      { id: 'large', label: 'Large' }
                    ]}
                    onChange={(transcriptSize) => patchLook({ transcriptSize })}
                  />
                  <Segmented
                    label="Transcript width"
                    hint="Maximum width of the conversation and composer columns."
                    value={draft.appearance.transcriptWidth}
                    options={[
                      { id: 'narrow', label: 'Narrow' },
                      { id: 'medium', label: 'Medium' },
                      { id: 'wide', label: 'Wide' }
                    ]}
                    onChange={(transcriptWidth) => patchLook({ transcriptWidth })}
                  />
                </Section>

                <Section title="Code">
                  <Field
                    label="Code font"
                    hint="A monospace family for code blocks and shell output. Empty uses the built-in stack."
                  >
                    <input
                      value={draft.appearance.codeFont}
                      onChange={(e) => patchLook({ codeFont: e.target.value })}
                      placeholder="e.g. JetBrains Mono"
                      className={inputClass}
                    />
                    <CodePreview font={draft.appearance.codeFont} />
                  </Field>
                  <Toggle
                    label="Show line numbers"
                    checked={draft.appearance.showLineNumbers}
                    onChange={(v) => patchLook({ showLineNumbers: v })}
                  />
                  <Field label="Collapse code blocks longer than (lines)">
                    <input
                      type="number"
                      min="5"
                      value={draft.appearance.collapseCodeOverLines}
                      onChange={(e) => patchLook({ collapseCodeOverLines: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                </Section>
              </>
            )}

            {tab === 'keys' && (
              <Section title="Keybindings">
                <p className="pb-2 text-[11.5px] text-faint">
                  Use names like Ctrl, Shift, Alt and Enter. Shift+Tab always cycles permission
                  modes.
                </p>
                {Object.entries(draft.keybindings).map(([action, binding]) => (
                  <div key={action} className="flex items-center gap-3 py-1.5">
                    <span className="w-32 shrink-0 text-[12.5px] text-muted">{action}</span>
                    <input
                      value={binding}
                      onChange={(e) =>
                        patch({ keybindings: { ...draft.keybindings, [action]: e.target.value } })
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                ))}
              </Section>
            )}

            {tab === 'benchmark' && (
              <BenchmarkPanel
                running={benchmarkRunning}
                progress={benchmarkProgress}
                modelTokensPerSecond={modelTokensPerSecond}
                report={benchmarkReport}
                onRun={(model) => void runBenchmark(model)}
              />
            )}

            {tab === 'about' && info && (
              <Section title={`flashgent ${info.version}`}>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  A local-first coding agent by <b className="text-ink">flashback</b>. Sessions,
                  tool calls and settings never leave this machine.
                </p>

                <div className="mt-4 rounded-lg border border-line bg-canvas p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12.5px] font-medium text-ink">Software Updates</div>
                      <div className="text-[11.5px] text-faint">
                        {updateInfo?.available
                          ? `New version available: v${updateInfo.version}`
                          : `You are on the latest version (v${info.version})`}
                      </div>
                    </div>
                    <div>
                      {updateInfo?.downloaded ? (
                        <button
                          type="button"
                          onClick={() => void installUpdate()}
                          className="rounded bg-brand px-3 py-1 text-[11.5px] font-medium text-white hover:opacity-90"
                        >
                          Restart & Install
                        </button>
                      ) : updateInfo?.available ? (
                        <button
                          type="button"
                          onClick={() => void downloadUpdate()}
                          className="rounded bg-brand px-3 py-1 text-[11.5px] font-medium text-white hover:opacity-90"
                        >
                          Download v{updateInfo.version}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void checkForUpdates()}
                          className="rounded border border-line bg-raised px-3 py-1 text-[11.5px] text-muted hover:text-ink"
                        >
                          Check for Updates
                        </button>
                      )}
                    </div>
                  </div>

                  {updateProgress && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] text-faint">
                        <span>Downloading update...</span>
                        <span>{updateProgress.percent}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full bg-brand transition-all"
                          style={{ width: `${updateProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {updateInfo?.releaseNotes && (
                    <div className="mt-3 rounded border border-line bg-raised/50 p-2 text-[11.5px] text-muted">
                      <div className="font-medium text-ink">Release Notes:</div>
                      <div className="mt-1 whitespace-pre-wrap">{updateInfo.releaseNotes}</div>
                    </div>
                  )}
                </div>

                <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1.5 font-mono text-[11.5px] text-muted">
                  <dt className="text-faint">electron</dt>
                  <dd>{info.electron}</dd>
                  <dt className="text-faint">node</dt>
                  <dd>{info.node}</dd>
                  <dt className="text-faint">platform</dt>
                  <dd>{info.platform}</dd>
                  <dt className="text-faint">config</dt>
                  <dd className="break-all">{info.configPath}</dd>
                  <dt className="text-faint">database</dt>
                  <dd className="break-all">{info.userDataPath}</dd>
                  <dt className="text-faint">logs</dt>
                  <dd className="break-all">{info.logPath}</dd>
                </dl>
                <p className="pt-4 text-[11.5px] text-faint">Licensed under GPL-3.0.</p>
              </Section>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

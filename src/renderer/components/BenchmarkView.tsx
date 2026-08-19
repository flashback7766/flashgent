import type { BenchmarkProgress, BenchmarkReport, BenchmarkRunRecord, BenchmarkTier, ScenarioResult } from '@shared/types'
import { useEffect, useState } from 'react'
import { formatRelativeTime } from '../lib/format.js'
import { useApp } from '../store/app.js'

export function BenchmarkView(): React.ReactElement {
  const models = useApp((s) => s.models)
  const config = useApp((s) => s.config)
  const toast = useApp((s) => s.toast)

  const [selectedModel, setSelectedModel] = useState<string>(config?.lastModel || models[0]?.id || '')
  const [selectedTier, setSelectedTier] = useState<BenchmarkTier | 'all'>('all')
  const [concurrency, setConcurrency] = useState<number>(1)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null)
  const [activeReport, setActiveReport] = useState<BenchmarkReport | null>(null)
  const [history, setHistory] = useState<BenchmarkRunRecord[]>([])
  const [activeTab, setActiveTab] = useState<'latest' | 'leaderboard'>('latest')
  const [tierFilter, setTierFilter] = useState<'all' | 'easy' | 'medium' | 'hard' | 'hell' | 'failed'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null)

  // Load past runs on mount
  const loadHistory = async (): Promise<void> => {
    const res = await window.flashgent.benchmark.list()
    if (res.ok) {
      setHistory(res.value)
      if (res.value.length > 0 && !activeReport) {
        try {
          const firstReport = JSON.parse(res.value[0]?.reportJson || '') as BenchmarkReport
          setActiveReport(firstReport)
        } catch {
          // ignore corrupted json
        }
      }
    }
  }

  useEffect(() => {
    void loadHistory()

    const unsubProgress = window.flashgent.benchmark.onProgress((p) => {
      setRunning(true)
      setProgress(p)
    })

    const unsubDone = window.flashgent.benchmark.onDone((res) => {
      setRunning(false)
      setProgress(null)
      setActiveReport(res.report)
      toast('success', `Benchmark finished! Score: ${res.report.totalScore.toFixed(1)} / 100`)
      void loadHistory()
    })

    return () => {
      unsubProgress()
      unsubDone()
    }
  }, [])

  const startBenchmark = async (targetScenarioId?: string): Promise<void> => {
    if (running) return
    setRunning(true)
    const expectedTotal = targetScenarioId ? 1 : selectedTier === 'easy' ? 50 : selectedTier === 'medium' ? 30 : selectedTier === 'hard' ? 15 : selectedTier === 'hell' ? 5 : 100
    setProgress({ index: 0, total: expectedTotal, scenario: 'Initializing benchmark suite...', score: 0 })
    try {
      const res = await window.flashgent.benchmark.run({
        model: selectedModel || undefined,
        tier: selectedTier,
        scenarioId: targetScenarioId,
        concurrency
      })
      if (!res.ok) {
        setRunning(false)
        setProgress(null)
        toast('error', `Benchmark failed: ${res.error}`)
      }
    } catch (err) {
      setRunning(false)
      setProgress(null)
      toast('error', String(err))
    }
  }

  const deleteRun = async (id: string): Promise<void> => {
    const res = await window.flashgent.benchmark.delete(id)
    if (res.ok) {
      toast('info', 'Run record deleted')
      void loadHistory()
    }
  }

  const filteredScenarios = (activeReport?.scenarios || []).filter((sc) => {
    if (tierFilter === 'failed' && sc.passed) return false
    if (tierFilter !== 'all' && tierFilter !== 'failed' && sc.tier !== tierFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return sc.name.toLowerCase().includes(q) || sc.id.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-canvas p-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-ink">Benchmark Arena</h1>
            <span className="rounded bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
              100-Point Standard (100 Scenarios)
            </span>
          </div>
          <p className="text-[12.5px] text-muted">
            Evaluate coding precision, subagent planning, architecture, and reasoning on your local models across 4 tiers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Parallel Workers Concurrency */}
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-muted">
            <span className="text-[11px] uppercase font-semibold text-faint">Parallel:</span>
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={running}
              className="bg-transparent font-semibold text-ink outline-none cursor-pointer"
            >
              <option value={1}>1x (Sequential)</option>
              <option value={2}>2x Parallel</option>
              <option value={4}>4x Parallel</option>
              <option value={8}>8x Parallel</option>
            </select>
          </div>

          {/* Tier Run Filter */}
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-muted">
            <span className="text-[11px] uppercase font-semibold text-faint">Scope:</span>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value as any)}
              disabled={running}
              className="bg-transparent font-semibold text-ink outline-none cursor-pointer"
            >
              <option value="all">All Tiers (100)</option>
              <option value="easy">Easy Only (50)</option>
              <option value="medium">Medium Only (30)</option>
              <option value="hard">Hard Only (15)</option>
              <option value="hell">Hell Only (5)</option>
            </select>
          </div>

          {/* Model Selector */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={running}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none"
          >
            {models.length === 0 && <option value="">No loaded models found</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>

          {/* Run Button */}
          <button
            type="button"
            onClick={() => void startBenchmark()}
            disabled={running}
            className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all ${
              running ? 'bg-brand/60 cursor-not-allowed' : 'bg-brand hover:brightness-110'
            }`}
          >
            {running ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Running ({progress?.index ?? 0}/{progress?.total ?? 100})...
              </>
            ) : (
              '⚡ Run Benchmark'
            )}
          </button>
        </div>
      </div>

      {/* Progress Bar while running */}
      {running && progress && (
        <div className="mt-4 rounded-lg border border-brand/30 bg-brand/5 p-4">
          <div className="flex items-center justify-between text-[12.5px] text-ink">
            <span className="font-medium truncate max-w-[70%]">Current: {progress.scenario}</span>
            <span className="text-muted font-mono">
              {progress.index} / {progress.total} completed ({concurrency}x workers)
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{ width: `${(progress.index / (progress.total || 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Scoreboard Cards */}
      {activeReport && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Overall Normalized Score Card */}
          <div className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-sm">
            <span className="text-[12px] font-medium uppercase tracking-wider text-muted">Overall Score</span>
            <div className="my-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-ink">{activeReport.totalScore.toFixed(1)}</span>
              <span className="text-[14px] text-muted">/ 100 pts</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-brand font-medium">{activeReport.percentage.toFixed(1)}% Standard</span>
              {activeReport.rawScore !== undefined && (
                <span className="text-faint font-mono text-[11px]">Raw: {activeReport.rawScore} / {activeReport.rawMaxScore || 185} pts</span>
              )}
            </div>
          </div>

          {/* 4-Tier Accuracy Card */}
          <div className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-sm">
            <span className="text-[12px] font-medium uppercase tracking-wider text-muted">Tier Breakdown</span>
            <div className="my-1 space-y-1 text-[11.5px]">
              <div className="flex justify-between">
                <span className="text-muted">Easy (50x0.5):</span>
                <span className="font-semibold text-ink">{activeReport.summary.easy.passed}/{activeReport.summary.easy.total} ({activeReport.summary.easy.score.toFixed(1)} pts)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Medium (30x2.0):</span>
                <span className="font-semibold text-ink">{activeReport.summary.medium.passed}/{activeReport.summary.medium.total} ({activeReport.summary.medium.score.toFixed(1)} pts)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Hard (15x4.0):</span>
                <span className="font-semibold text-ink">{activeReport.summary.hard.passed}/{activeReport.summary.hard.total} ({activeReport.summary.hard.score.toFixed(1)} pts)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Hell (5x8.0):</span>
                <span className="font-semibold text-rose-500">{activeReport.summary.hell?.passed ?? 0}/{activeReport.summary.hell?.total ?? 0} ({activeReport.summary.hell?.score.toFixed(1) ?? '0.0'} pts)</span>
              </div>
            </div>
            <span className="text-[11px] text-faint">Base tasks: 80 pts normalized</span>
          </div>

          {/* Quality Modifiers Card */}
          <div className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-sm">
            <span className="text-[12px] font-medium uppercase tracking-wider text-muted">Quality Modifiers</span>
            <div className="my-1 space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span className="text-muted">Tool Syntax:</span>
                <span className="font-semibold text-ok">+{activeReport.qualityModifiers.toolSyntaxPrecision.toFixed(1)} / 7.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Thinking Efficiency:</span>
                <span className="font-semibold text-brand">+{activeReport.qualityModifiers.thinkingEfficiency.toFixed(1)} / 7.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Speed & Economy:</span>
                <span className="font-semibold text-ink">+{activeReport.qualityModifiers.executionSpeedAndEconomy.toFixed(1)} / 6.0</span>
              </div>
            </div>
            <span className="text-[11px] text-faint">Bonus: +{activeReport.qualityModifiers.totalModifier.toFixed(1)} / 20.0 pts</span>
          </div>

          {/* Tested Model Details */}
          <div className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-sm">
            <span className="text-[12px] font-medium uppercase tracking-wider text-muted">Tested Model</span>
            <div className="my-2 truncate font-mono text-[13px] font-semibold text-ink" title={activeReport.modelName}>
              {activeReport.modelName}
            </div>
            <span className="text-[11.5px] text-muted">{new Date(activeReport.timestamp).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Tabs & Search Filter Bar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-2">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('latest')}
            className={`border-b-2 pb-2 text-[13px] font-medium transition-colors ${
              activeTab === 'latest' ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Scenario Breakdown ({filteredScenarios.length}/{activeReport?.scenarios.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('leaderboard')}
            className={`border-b-2 pb-2 text-[13px] font-medium transition-colors ${
              activeTab === 'leaderboard' ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            Leaderboard & History ({history.length})
          </button>
        </div>

        {activeTab === 'latest' && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <input
              type="text"
              placeholder="Search scenarios..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink placeholder-muted outline-none w-44"
            />

            {/* Tier Filter Pills */}
            {(['all', 'easy', 'medium', 'hard', 'hell', 'failed'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(tier)}
                className={`rounded px-2.5 py-1 text-[11.5px] capitalize font-medium transition-colors ${
                  tierFilter === tier ? 'bg-brand text-white' : 'bg-surface text-muted hover:bg-raised'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab 1: Latest Run Scenario List */}
      {activeTab === 'latest' && (
        <div className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
          {filteredScenarios.length === 0 && (
            <div className="p-8 text-center text-[13px] text-muted">
              {activeReport ? 'No scenarios match the selected filter.' : 'Run a benchmark to see the breakdown.'}
            </div>
          )}

          {filteredScenarios.map((scenario: ScenarioResult, idx: number) => {
            const isExpanded = expandedScenario === scenario.id
            return (
              <div key={scenario.id} className="transition-colors hover:bg-raised/40">
                <div
                  onClick={() => setExpandedScenario(isExpanded ? null : scenario.id)}
                  className="flex cursor-pointer items-center justify-between p-3.5 text-[12.5px]"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                        scenario.passed ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'
                      }`}
                    >
                      {scenario.passed ? '✓' : '✗'}
                    </span>
                    <span className="text-faint font-mono text-[11px]">#{idx + 1}</span>
                    <span className="font-medium text-ink">{scenario.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        scenario.tier === 'easy'
                          ? 'bg-line/60 text-muted'
                          : scenario.tier === 'medium'
                            ? 'bg-brand/10 text-brand'
                            : scenario.tier === 'hard'
                              ? 'bg-warn/10 text-warn'
                              : 'bg-rose-500/15 text-rose-600 font-bold'
                      }`}
                    >
                      {scenario.tier}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void startBenchmark(scenario.id)
                      }}
                      disabled={running}
                      className="rounded px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10 border border-brand/20 transition-colors"
                      title="Run only this single scenario"
                    >
                      ▶ Test
                    </button>
                    <span className="font-mono text-[12px] text-muted">{scenario.durationMs}ms</span>
                    <span className="font-semibold text-ink">
                      {scenario.earnedPoints} / {scenario.maxPoints} pts
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-line/60 bg-canvas/40 p-4 text-[12px]">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <span className="font-semibold text-muted">Scenario ID:</span>{' '}
                        <span className="font-mono text-ink">{scenario.id}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-muted">Status:</span>{' '}
                        <span className={scenario.passed ? 'text-ok font-semibold' : 'text-bad font-semibold'}>
                          {scenario.passed ? 'PASSED' : 'FAILED'}
                        </span>
                      </div>
                    </div>
                    {scenario.message && (
                      <div className="mt-2 rounded bg-bad/5 p-2 font-mono text-[11.5px] text-bad">
                        {scenario.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Tab 2: Leaderboard & History */}
      {activeTab === 'leaderboard' && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-line bg-surface text-faint font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="p-3.5">Model</th>
                <th className="p-3.5">Normalized Score</th>
                <th className="p-3.5">Percentage</th>
                <th className="p-3.5">Date</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted">
                    No benchmark runs recorded yet.
                  </td>
                </tr>
              )}
              {history.map((record) => (
                <tr key={record.id} className="hover:bg-raised/40">
                  <td className="p-3.5 font-medium font-mono text-ink">{record.model}</td>
                  <td className="p-3.5 font-bold text-ink">
                    {record.score.toFixed(1)} / {record.maxScore}
                  </td>
                  <td className="p-3.5 font-semibold text-brand">{record.percentage.toFixed(1)}%</td>
                  <td className="p-3.5 text-muted">{formatRelativeTime(record.createdAt)}</td>
                  <td className="p-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const rep = JSON.parse(record.reportJson) as BenchmarkReport
                          setActiveReport(rep)
                          setActiveTab('latest')
                        } catch {
                          toast('error', 'Could not open report')
                        }
                      }}
                      className="mr-2 rounded px-2 py-1 text-[11.5px] font-medium text-brand hover:bg-brand/10"
                    >
                      View Report
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteRun(record.id)}
                      className="rounded px-2 py-1 text-[11.5px] text-faint hover:text-bad"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionCreateInput, SessionSearchHit, SessionSearchQuery, Snippet } from '../../shared/ipc.js'
import type {
  BenchmarkReport,
  BenchmarkRunRecord,
  ContentBlock,
  FileSnapshot,
  Message,
  Session,
  ToolUseBlock
} from '../../shared/types.js'
import { logger } from '../logger.js'
import { backupDir, dbFile } from '../paths.js'
import { migrate } from './schema.js'

const BACKUP_RETENTION_DAYS = 7

let db: Database.Database | null = null

export function openDatabase(): Database.Database {
  if (db) return db
  db = new Database(dbFile())
  migrate(db)
  void runDailyBackup()
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}

function handle(): Database.Database {
  return db ?? openDatabase()
}

// --- Backup ----------------------------------------------------------------

/** One backup per calendar day, pruned after a week. */
async function runDailyBackup(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  const target = join(backupDir(), `flashgent-${day}.db`)
  if (existsSync(target)) return
  try {
    await handle().backup(target)
    logger.info(`database backed up to ${target}`)
  } catch (err) {
    logger.warn('database backup failed', String(err))
    return
  }
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
  for (const name of readdirSync(backupDir())) {
    const full = join(backupDir(), name)
    try {
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
    } catch {
      // Ignore: a stale backup we cannot remove is harmless.
    }
  }
}

// --- Row mapping -----------------------------------------------------------

interface SessionRow {
  id: string
  title: string
  cwd: string
  model: string | null
  preset_id: string | null
  effort: string
  permission_mode: string
  starred: number
  forked_from: string | null
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  session_id: string
  seq: number
  role: string
  blocks: string
  model: string | null
  usage: string | null
  created_at: number
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  title: r.title,
  cwd: r.cwd,
  model: r.model,
  presetId: r.preset_id,
  effort: r.effort as Session['effort'],
  permissionMode: r.permission_mode as Session['permissionMode'],
  starred: r.starred === 1,
  forkedFrom: r.forked_from,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toMessage = (r: MessageRow): Message => {
  const message: Message = {
    id: r.id,
    sessionId: r.session_id,
    role: r.role as Message['role'],
    blocks: JSON.parse(r.blocks) as ContentBlock[],
    model: r.model,
    createdAt: r.created_at
  }
  if (r.usage) message.usage = JSON.parse(r.usage) as Message['usage']
  return message
}

/** Plain text of a message, used for full-text search. */
function searchableText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text' || b.type === 'thinking') return b.text
      return `${b.name} ${JSON.stringify(b.input)} ${b.result?.content ?? ''}`
    })
    .join('\n')
}

// --- Sessions --------------------------------------------------------------

export function listSessions(): Session[] {
  const rows = handle()
    .prepare('SELECT * FROM sessions ORDER BY starred DESC, updated_at DESC')
    .all() as SessionRow[]
  return rows.map(toSession)
}

export function createSession(input: SessionCreateInput): Session {
  const now = Date.now()
  const session: Session = {
    id: randomUUID(),
    title: input.title?.trim() || 'New chat',
    cwd: input.cwd,
    model: input.model ?? null,
    presetId: input.presetId ?? null,
    effort: input.effort ?? 'high',
    permissionMode: input.permissionMode ?? 'manual',
    starred: false,
    forkedFrom: input.forkedFrom ?? null,
    createdAt: now,
    updatedAt: now
  }
  handle()
    .prepare(
      `INSERT INTO sessions
         (id, title, cwd, model, preset_id, effort, permission_mode, starred, forked_from, created_at, updated_at)
       VALUES (@id, @title, @cwd, @model, @presetId, @effort, @permissionMode, 0, @forkedFrom, @createdAt, @updatedAt)`
    )
    .run(session)
  return session
}

export function updateSession(id: string, patch: Partial<Session>): Session {
  const existing = handle().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined
  if (!existing) throw new Error(`session ${id} not found`)

  const merged: Session = { ...toSession(existing), ...patch, id, updatedAt: Date.now() }
  handle()
    .prepare(
      `UPDATE sessions
          SET title = @title, cwd = @cwd, model = @model, preset_id = @presetId,
              effort = @effort, permission_mode = @permissionMode,
              starred = @starredInt, updated_at = @updatedAt
        WHERE id = @id`
    )
    .run({ ...merged, starredInt: merged.starred ? 1 : 0 })
  return merged
}

export function deleteSession(id: string): boolean {
  const tx = handle().transaction(() => {
    handle().prepare('DELETE FROM messages_fts WHERE session_id = ?').run(id)
    // messages and tool_calls cascade from the sessions row.
    handle().prepare('DELETE FROM sessions WHERE id = ?').run(id)
  })
  tx()
  return true
}

/**
 * Copy a session's history up to and including `uptoMessageId` into a new
 * session, leaving the original untouched.
 */
export function forkSession(id: string, uptoMessageId: string): Session {
  const source = handle().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined
  if (!source) throw new Error(`session ${id} not found`)

  const cutoff = handle()
    .prepare('SELECT seq FROM messages WHERE id = ? AND session_id = ?')
    .get(uptoMessageId, id) as { seq: number } | undefined
  if (!cutoff) throw new Error(`message ${uptoMessageId} not found in session ${id}`)

  const fork = createSession({
    title: `${source.title} (fork)`,
    cwd: source.cwd,
    model: source.model,
    presetId: source.preset_id,
    effort: source.effort as Session['effort'],
    permissionMode: source.permission_mode as Session['permissionMode'],
    forkedFrom: id
  })

  const rows = handle()
    .prepare('SELECT * FROM messages WHERE session_id = ? AND seq <= ? ORDER BY seq')
    .all(id, cutoff.seq) as MessageRow[]

  const tx = handle().transaction(() => {
    for (const row of rows) {
      const message = toMessage(row)
      appendMessage({ ...message, id: randomUUID(), sessionId: fork.id })
    }
  })
  tx()
  return fork
}

// --- Messages --------------------------------------------------------------

export function listMessages(sessionId: string): Message[] {
  const rows = handle()
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq')
    .all(sessionId) as MessageRow[]
  return rows.map(toMessage)
}

export function appendMessage(message: Message): Message {
  const d = handle()
  const tx = d.transaction(() => {
    const next = d
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM messages WHERE session_id = ?')
      .get(message.sessionId) as { seq: number }

    d.prepare(
      `INSERT INTO messages (id, session_id, seq, role, blocks, model, usage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      message.id,
      message.sessionId,
      next.seq,
      message.role,
      JSON.stringify(message.blocks),
      message.model,
      message.usage ? JSON.stringify(message.usage) : null,
      message.createdAt
    )

    indexMessage(message)
    syncToolCalls(message)
    d.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
      message.createdAt,
      message.sessionId
    )
  })
  tx()
  return message
}

export function updateMessage(id: string, patch: Partial<Message>): Message {
  const d = handle()
  const row = d.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
  if (!row) throw new Error(`message ${id} not found`)

  const merged: Message = { ...toMessage(row), ...patch, id }
  const tx = d.transaction(() => {
    d.prepare('UPDATE messages SET blocks = ?, model = ?, usage = ? WHERE id = ?').run(
      JSON.stringify(merged.blocks),
      merged.model,
      merged.usage ? JSON.stringify(merged.usage) : null,
      id
    )
    indexMessage(merged)
    syncToolCalls(merged)
    d.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), merged.sessionId)
  })
  tx()
  return merged
}

/** Drop `messageId` and everything after it — the rewind operation. */
export function truncateFrom(sessionId: string, messageId: string): number {
  const d = handle()
  const anchor = d
    .prepare('SELECT seq FROM messages WHERE id = ? AND session_id = ?')
    .get(messageId, sessionId) as { seq: number } | undefined
  if (!anchor) return 0

  const doomed = d
    .prepare('SELECT id FROM messages WHERE session_id = ? AND seq >= ?')
    .all(sessionId, anchor.seq) as Array<{ id: string }>

  const tx = d.transaction(() => {
    for (const { id } of doomed) {
      d.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(id)
    }
    d.prepare('DELETE FROM messages WHERE session_id = ? AND seq >= ?').run(sessionId, anchor.seq)
  })
  tx()
  return doomed.length
}

function indexMessage(message: Message): void {
  const d = handle()
  d.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(message.id)
  d.prepare('INSERT INTO messages_fts (body, message_id, session_id) VALUES (?, ?, ?)').run(
    searchableText(message.blocks),
    message.id,
    message.sessionId
  )
}

function syncToolCalls(message: Message): void {
  const d = handle()
  d.prepare('DELETE FROM tool_calls WHERE message_id = ?').run(message.id)
  // OR REPLACE: a model can emit two calls carrying the same id in one turn,
  // and the last write is the one that matters.
  const insert = d.prepare(
    `INSERT OR REPLACE INTO tool_calls
       (id, message_id, session_id, name, input, status, result, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const block of message.blocks) {
    if (block.type !== 'tool_use') continue
    const tool = block as ToolUseBlock
    insert.run(
      tool.id,
      message.id,
      message.sessionId,
      tool.name,
      JSON.stringify(tool.input),
      tool.status,
      tool.result ? JSON.stringify(tool.result) : null,
      tool.durationMs ?? null,
      message.createdAt
    )
  }
}

// --- Search ----------------------------------------------------------------

export function search(query: SessionSearchQuery): SessionSearchHit[] {
  const limit = Math.min(query.limit ?? 50, 200)
  const clauses: string[] = []
  const params: unknown[] = []

  let from = 'sessions s'
  if (query.text?.trim()) {
    from = `messages_fts f
            JOIN messages m ON m.id = f.message_id
            JOIN sessions s ON s.id = m.session_id`
    clauses.push('messages_fts MATCH ?')
    params.push(escapeFts(query.text.trim()))
  }
  if (query.model) {
    clauses.push('s.model = ?')
    params.push(query.model)
  }
  if (query.from !== undefined) {
    clauses.push('s.updated_at >= ?')
    params.push(query.from)
  }
  if (query.to !== undefined) {
    clauses.push('s.updated_at <= ?')
    params.push(query.to)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  if (query.text?.trim()) {
    const rows = handle()
      .prepare(
        `SELECT s.id AS sessionId, s.title AS title, s.updated_at AS createdAt,
                snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet
           FROM ${from} ${where}
          ORDER BY rank
          LIMIT ?`
      )
      .all(...params, limit) as SessionSearchHit[]
    return rows
  }

  return handle()
    .prepare(
      `SELECT s.id AS sessionId, s.title AS title, s.updated_at AS createdAt, '' AS snippet
         FROM ${from} ${where}
        ORDER BY s.updated_at DESC
        LIMIT ?`
    )
    .all(...params, limit) as SessionSearchHit[]
}

/**
 * FTS5 treats a lot of punctuation as syntax. Quoting each term keeps user
 * input like `foo-bar` or `a:b` from blowing up the query parser.
 */
function escapeFts(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' ')
}

// --- Snippets --------------------------------------------------------------

export function listSnippets(): Snippet[] {
  return handle()
    .prepare(
      `SELECT id, title, language, code, session_id AS sessionId, created_at AS createdAt
         FROM snippets ORDER BY created_at DESC`
    )
    .all() as Snippet[]
}

export function createSnippet(input: Omit<Snippet, 'id' | 'createdAt'>): Snippet {
  const snippet: Snippet = { ...input, id: randomUUID(), createdAt: Date.now() }
  handle()
    .prepare(
      `INSERT INTO snippets (id, title, language, code, session_id, created_at)
       VALUES (@id, @title, @language, @code, @sessionId, @createdAt)`
    )
    .run(snippet)
  return snippet
}

export function deleteSnippet(id: string): boolean {
  handle().prepare('DELETE FROM snippets WHERE id = ?').run(id)
  return true
}

// --- Benchmark Runs --------------------------------------------------------

export function saveBenchmarkRun(report: BenchmarkReport): BenchmarkRunRecord {
  const record: BenchmarkRunRecord = {
    id: randomUUID(),
    model: report.modelName,
    score: report.totalScore,
    maxScore: report.maxScore,
    percentage: report.percentage,
    reportJson: JSON.stringify(report),
    createdAt: Date.now()
  }

  handle()
    .prepare(
      `INSERT INTO benchmark_runs (id, model, score, max_score, percentage, report_json, created_at)
       VALUES (@id, @model, @score, @maxScore, @percentage, @reportJson, @createdAt)`
    )
    .run(record)

  return record
}

export function listBenchmarkRuns(): BenchmarkRunRecord[] {
  const rows = handle()
    .prepare(
      `SELECT id, model, score, max_score AS maxScore, percentage, report_json AS reportJson, created_at AS createdAt
         FROM benchmark_runs ORDER BY created_at DESC`
    )
    .all() as BenchmarkRunRecord[]
  return rows
}

export function deleteBenchmarkRun(id: string): boolean {
  handle().prepare('DELETE FROM benchmark_runs WHERE id = ?').run(id)
  return true
}

// --- File Snapshots Time Machine -------------------------------------------

export function saveFileSnapshot(snapshot: Omit<FileSnapshot, 'id' | 'createdAt'>): FileSnapshot {
  const record: FileSnapshot = {
    ...snapshot,
    id: randomUUID(),
    createdAt: Date.now()
  }

  handle()
    .prepare(
      `INSERT INTO file_snapshots (id, session_id, message_id, tool_call_id, path, content_before, content_after, created_at)
       VALUES (@id, @sessionId, @messageId, @toolCallId, @path, @contentBefore, @contentAfter, @createdAt)`
    )
    .run(record)

  return record
}

export function listFileSnapshots(sessionId: string): FileSnapshot[] {
  return handle()
    .prepare(
      `SELECT id, session_id AS sessionId, message_id AS messageId, tool_call_id AS toolCallId,
              path, content_before AS contentBefore, content_after AS contentAfter, created_at AS createdAt
         FROM file_snapshots WHERE session_id = ? ORDER BY created_at ASC`
    )
    .all(sessionId) as FileSnapshot[]
}

export function getFileSnapshot(id: string): FileSnapshot | null {
  const row = handle()
    .prepare(
      `SELECT id, session_id AS sessionId, message_id AS messageId, tool_call_id AS toolCallId,
              path, content_before AS contentBefore, content_after AS contentAfter, created_at AS createdAt
         FROM file_snapshots WHERE id = ?`
    )
    .get(id) as FileSnapshot | undefined
  return row ?? null
}

export function deleteFileSnapshotsForSession(sessionId: string): boolean {
  handle().prepare('DELETE FROM file_snapshots WHERE session_id = ?').run(sessionId)
  return true
}


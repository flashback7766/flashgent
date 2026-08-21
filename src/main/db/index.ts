import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, desc, asc, and, gte, lte, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type {
  SessionCreateInput,
  SessionSearchHit,
  SessionSearchQuery,
  Snippet
} from '../../shared/ipc.js'
import type {
  BenchmarkReport,
  BenchmarkRunRecord,
  ContentBlock,
  FileSnapshot,
  Message,
  Session
} from '../../shared/types.js'
import { logger } from '../logger.js'
import { backupDir, dbFile, migrationsDir } from '../paths.js'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import {
  sessionsTable,
  messagesTable,
  toolCallsTable,
  snippetsTable,
  benchmarkRunsTable,
  fileSnapshotsTable,
  messagesFtsTable
} from './schema.js'

const BACKUP_RETENTION_DAYS = 7

let sqlite: Database.Database | null = null
let db: ReturnType<typeof drizzle> | null = null

export function openDatabase(): Database.Database {
  if (sqlite) return sqlite
  sqlite = new Database(dbFile())
  db = drizzle(sqlite)
  migrate(db, { migrationsFolder: migrationsDir() })
  void runDailyBackup()
  return sqlite
}

export function closeDatabase(): void {
  sqlite?.close()
  sqlite = null
  db = null
}

function handle(): ReturnType<typeof drizzle> {
  if (!db) {
    openDatabase()
  }
  if (!db) throw new Error('Failed to initialize database')
  return db
}

/**
 * Drizzle ORM does not expose the native SQLite `.backup()` API, so we need
 * this escape hatch to access the underlying better-sqlite3 instance when
 * performing the daily backups.
 */
function raw(): Database.Database {
  if (!sqlite) {
    openDatabase()
  }
  if (!sqlite) throw new Error('Failed to initialize database')
  return sqlite
}

// --- Backup ----------------------------------------------------------------

/** One backup per calendar day, pruned after a week. */
async function runDailyBackup(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  const target = join(backupDir(), `flashgent-${day}.db`)
  if (existsSync(target)) return
  try {
    await raw().backup(target)
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

const toFileSnapshot = (r: typeof fileSnapshotsTable.$inferSelect): FileSnapshot => {
  return {
    id: r.id,
    sessionId: r.sessionId,
    messageId: r.messageId ?? null,
    toolCallId: r.toolCallId ?? null,
    path: r.path,
    contentBefore: r.contentBefore ?? null,
    contentAfter: r.contentAfter ?? null,
    createdAt: r.createdAt
  }
}

const toSession = (r: typeof sessionsTable.$inferSelect): Session => {
  return {
    id: r.id,
    title: r.title,
    cwd: r.cwd,
    model: r.model,
    presetId: r.presetId,
    effort: r.effort,
    permissionMode: r.permissionMode,
    starred: r.starred === 1,
    forkedFrom: r.forkedFrom,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

const toMessage = (r: typeof messagesTable.$inferSelect): Message => {
  const message: Message = {
    id: r.id,
    sessionId: r.sessionId,
    role: r.role,
    blocks: r.blocks,
    model: r.model,
    createdAt: r.createdAt
  }
  if (r.usage) message.usage = r.usage
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
    .select()
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.starred), desc(sessionsTable.updatedAt))
    .all()
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
    .insert(sessionsTable)
    .values({
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      model: session.model,
      presetId: session.presetId,
      effort: session.effort,
      permissionMode: session.permissionMode,
      starred: 0,
      forkedFrom: session.forkedFrom,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    })
    .run()

  return session
}

export function updateSession(id: string, patch: Partial<Session>): Session {
  const existing = handle().select().from(sessionsTable).where(eq(sessionsTable.id, id)).get()
  if (!existing) throw new Error(`session ${id} not found`)

  const merged: Session = { ...toSession(existing), ...patch, id, updatedAt: Date.now() }

  handle()
    .update(sessionsTable)
    .set({
      title: merged.title,
      cwd: merged.cwd,
      model: merged.model,
      presetId: merged.presetId,
      effort: merged.effort,
      permissionMode: merged.permissionMode,
      starred: merged.starred ? 1 : 0,
      updatedAt: merged.updatedAt
    })
    .where(eq(sessionsTable.id, id))
    .run()

  return merged
}

export function deleteSession(id: string): boolean {
  handle().transaction((tx) => {
    tx.delete(messagesFtsTable).where(eq(messagesFtsTable.sessionId, id)).run()
    tx.delete(sessionsTable).where(eq(sessionsTable.id, id)).run()
  })
  return true
}

/**
 * Copy a session's history up to and including `uptoMessageId` into a new
 * session, leaving the original untouched.
 */
export function forkSession(id: string, uptoMessageId: string): Session {
  const source = handle().select().from(sessionsTable).where(eq(sessionsTable.id, id)).get()
  if (!source) throw new Error(`session ${id} not found`)

  const cutoff = handle()
    .select({ seq: messagesTable.seq })
    .from(messagesTable)
    .where(and(eq(messagesTable.id, uptoMessageId), eq(messagesTable.sessionId, id)))
    .get()
  if (!cutoff) throw new Error(`message ${uptoMessageId} not found in session ${id}`)

  const fork = createSession({
    title: `${source.title} (fork)`,
    cwd: source.cwd,
    model: source.model,
    presetId: source.presetId,
    effort: source.effort,
    permissionMode: source.permissionMode,
    forkedFrom: id
  })

  const rows = handle()
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.sessionId, id), lte(messagesTable.seq, cutoff.seq)))
    .orderBy(asc(messagesTable.seq))
    .all()

  handle().transaction(() => {
    for (const row of rows) {
      const message = toMessage(row)
      appendMessage({ ...message, id: randomUUID(), sessionId: fork.id })
    }
  })
  return fork
}

// --- Messages --------------------------------------------------------------

export function listMessages(sessionId: string): Message[] {
  const rows = handle()
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(asc(messagesTable.seq))
    .all()
  return rows.map(toMessage)
}

export function appendMessage(message: Message): Message {
  handle().transaction((tx) => {
    const nextRow = tx
      .select({ seq: sql<number>`COALESCE(MAX(${messagesTable.seq}), 0) + 1` })
      .from(messagesTable)
      .where(eq(messagesTable.sessionId, message.sessionId))
      .get()
    const nextSeq = nextRow?.seq ?? 1

    tx.insert(messagesTable)
      .values({
        id: message.id,
        sessionId: message.sessionId,
        seq: nextSeq,
        role: message.role,
        blocks: message.blocks,
        model: message.model,
        usage: message.usage ?? null,
        createdAt: message.createdAt
      })
      .run()

    indexMessage(message)
    syncToolCalls(message)

    tx.update(sessionsTable)
      .set({ updatedAt: message.createdAt })
      .where(eq(sessionsTable.id, message.sessionId))
      .run()
  })
  return message
}

export function updateMessage(id: string, patch: Partial<Message>): Message {
  const row = handle().select().from(messagesTable).where(eq(messagesTable.id, id)).get()
  if (!row) throw new Error(`message ${id} not found`)

  const merged: Message = { ...toMessage(row), ...patch, id }
  handle().transaction((tx) => {
    tx.update(messagesTable)
      .set({
        blocks: merged.blocks,
        model: merged.model,
        usage: merged.usage ?? null
      })
      .where(eq(messagesTable.id, id))
      .run()

    indexMessage(merged)
    syncToolCalls(merged)

    tx.update(sessionsTable)
      .set({ updatedAt: Date.now() })
      .where(eq(sessionsTable.id, merged.sessionId))
      .run()
  })
  return merged
}

/** Drop `messageId` and everything after it — the rewind operation. */
export function truncateFrom(sessionId: string, messageId: string): number {
  const anchor = handle()
    .select({ seq: messagesTable.seq })
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.sessionId, sessionId)))
    .get()
  if (!anchor) return 0

  const doomed = handle()
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(eq(messagesTable.sessionId, sessionId), gte(messagesTable.seq, anchor.seq)))
    .all()

  handle().transaction((tx) => {
    for (const { id } of doomed) {
      tx.delete(messagesFtsTable).where(eq(messagesFtsTable.messageId, id)).run()
    }
    tx.delete(messagesTable)
      .where(and(eq(messagesTable.sessionId, sessionId), gte(messagesTable.seq, anchor.seq)))
      .run()
  })
  return doomed.length
}

function indexMessage(message: Message): void {
  handle().delete(messagesFtsTable).where(eq(messagesFtsTable.messageId, message.id)).run()
  handle()
    .insert(messagesFtsTable)
    .values({
      body: searchableText(message.blocks),
      messageId: message.id,
      sessionId: message.sessionId
    })
    .run()
}

function syncToolCalls(message: Message): void {
  handle().delete(toolCallsTable).where(eq(toolCallsTable.messageId, message.id)).run()

  for (const block of message.blocks) {
    if (block.type !== 'tool_use') continue

    // SQLite INSERT OR REPLACE in drizzle
    handle()
      .insert(toolCallsTable)
      .values({
        id: block.id,
        messageId: message.id,
        sessionId: message.sessionId,
        name: block.name,
        input: block.input,
        status: block.status,
        result: block.result ?? null,
        durationMs: block.durationMs ?? null,
        createdAt: message.createdAt
      })
      .onConflictDoUpdate({
        target: [toolCallsTable.messageId, toolCallsTable.id],
        set: {
          sessionId: message.sessionId,
          name: block.name,
          input: block.input,
          status: block.status,
          result: block.result ?? null,
          durationMs: block.durationMs ?? null,
          createdAt: message.createdAt
        }
      })
      .run()
  }
}

// --- Search ----------------------------------------------------------------

export function search(query: SessionSearchQuery): SessionSearchHit[] {
  const limitCount = Math.min(query.limit ?? 50, 200)
  const d = handle()

  if (query.text?.trim()) {
    const rawSearch = escapeFts(query.text.trim())

    let q = sql<SessionSearchHit>`SELECT s.id AS sessionId, s.title AS title, s.updated_at AS createdAt,
              snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet
         FROM messages_fts f
         JOIN messages m ON m.id = f.message_id
         JOIN sessions s ON s.id = m.session_id
        WHERE messages_fts MATCH ${rawSearch}`

    if (query.model) {
      q = sql`${q} AND s.model = ${query.model}`
    }
    if (query.from !== undefined) {
      q = sql`${q} AND s.updated_at >= ${query.from}`
    }
    if (query.to !== undefined) {
      q = sql`${q} AND s.updated_at <= ${query.to}`
    }

    q = sql`${q} ORDER BY rank LIMIT ${limitCount}`

    return handle().all(q)
  }

  // Without FTS we can use query builder
  let q = d
    .select({
      sessionId: sessionsTable.id,
      title: sessionsTable.title,
      createdAt: sessionsTable.updatedAt,
      snippet: sql<string>`''`
    })
    .from(sessionsTable)
    .$dynamic()

  if (query.model) {
    q = q.where(eq(sessionsTable.model, query.model))
  }
  if (query.from !== undefined) {
    q = q.where(gte(sessionsTable.updatedAt, query.from))
  }
  if (query.to !== undefined) {
    q = q.where(lte(sessionsTable.updatedAt, query.to))
  }

  return q.orderBy(desc(sessionsTable.updatedAt)).limit(limitCount).all()
}

/**
 * FTS5 treats a lot of punctuation as syntax. Quoting each term keeps user
 * input like `foo-bar` or `a:b` from blowing up the query parser.
 */
function escapeFts(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => {
      return `"${term.replace(/"/g, '""')}"`
    })
    .join(' ')
}

// --- Snippets --------------------------------------------------------------

export function listSnippets(): Snippet[] {
  const rows = handle().select().from(snippetsTable).orderBy(desc(snippetsTable.createdAt)).all()

  return rows.map((r) => {
    return {
      id: r.id,
      title: r.title,
      language: r.language,
      code: r.code,
      sessionId: r.sessionId ?? null,
      createdAt: r.createdAt
    }
  })
}

export function createSnippet(input: Omit<Snippet, 'id' | 'createdAt'>): Snippet {
  const snippet: Snippet = { ...input, id: randomUUID(), createdAt: Date.now() }

  handle()
    .insert(snippetsTable)
    .values({
      id: snippet.id,
      title: snippet.title,
      language: snippet.language,
      code: snippet.code,
      sessionId: snippet.sessionId,
      createdAt: snippet.createdAt
    })
    .run()

  return snippet
}

export function deleteSnippet(id: string): boolean {
  handle().delete(snippetsTable).where(eq(snippetsTable.id, id)).run()
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
    report: report,
    createdAt: Date.now()
  }

  handle()
    .insert(benchmarkRunsTable)
    .values({
      id: record.id,
      model: record.model,
      score: record.score,
      maxScore: record.maxScore,
      percentage: record.percentage,
      report: record.report,
      createdAt: record.createdAt
    })
    .run()

  return record
}

export function listBenchmarkRuns(): BenchmarkRunRecord[] {
  const rows = handle()
    .select()
    .from(benchmarkRunsTable)
    .orderBy(desc(benchmarkRunsTable.createdAt))
    .all()

  return rows.map((r) => {
    return {
      id: r.id,
      model: r.model,
      score: r.score,
      maxScore: r.maxScore,
      percentage: r.percentage,
      report: r.report,
      createdAt: r.createdAt
    }
  })
}

export function deleteBenchmarkRun(id: string): boolean {
  handle().delete(benchmarkRunsTable).where(eq(benchmarkRunsTable.id, id)).run()
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
    .insert(fileSnapshotsTable)
    .values({
      id: record.id,
      sessionId: record.sessionId,
      messageId: record.messageId,
      toolCallId: record.toolCallId,
      path: record.path,
      contentBefore: record.contentBefore,
      contentAfter: record.contentAfter,
      createdAt: record.createdAt
    })
    .run()

  return record
}

export function listFileSnapshots(sessionId: string): FileSnapshot[] {
  const rows = handle()
    .select()
    .from(fileSnapshotsTable)
    .where(eq(fileSnapshotsTable.sessionId, sessionId))
    .orderBy(asc(fileSnapshotsTable.createdAt))
    .all()
  return rows.map(toFileSnapshot)
}

export function getFileSnapshot(id: string): FileSnapshot | null {
  const row = handle().select().from(fileSnapshotsTable).where(eq(fileSnapshotsTable.id, id)).get()

  if (!row) return null
  return toFileSnapshot(row)
}

export function deleteFileSnapshotsForSession(sessionId: string): boolean {
  handle().delete(fileSnapshotsTable).where(eq(fileSnapshotsTable.sessionId, sessionId)).run()
  return true
}

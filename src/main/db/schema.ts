import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import type {
  BenchmarkReport,
  ContentBlock,
  EffortLevel,
  Message,
  PermissionMode,
  ToolResult
} from '../../shared/types.js'

export const sessionsTable = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  cwd: text('cwd').notNull(),
  model: text('model'),
  presetId: text('preset_id'),
  effort: text('effort').$type<EffortLevel>().notNull().default('high'),
  permissionMode: text('permission_mode').$type<PermissionMode>().notNull().default('manual'),
  starred: integer('starred').notNull().default(0),
  forkedFrom: text('forked_from'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const messagesTable = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  seq: integer('seq').notNull(),
  role: text('role').$type<Message['role']>().notNull(),
  blocks: text('blocks', { mode: 'json' }).$type<ContentBlock[]>().notNull(),
  model: text('model'),
  usage: text('usage', { mode: 'json' }).$type<Message['usage']>(),
  createdAt: integer('created_at').notNull()
})

export const toolCallsTable = sqliteTable('tool_calls', {
  rowId: integer('row_id').primaryKey({ autoIncrement: true }),
  id: text('id').notNull(),
  messageId: text('message_id').notNull(),
  sessionId: text('session_id').notNull(),
  name: text('name').notNull(),
  input: text('input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull(),
  result: text('result', { mode: 'json' }).$type<ToolResult>(),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at').notNull()
})

export const snippetsTable = sqliteTable('snippets', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  language: text('language').notNull(),
  code: text('code').notNull(),
  sessionId: text('session_id'),
  createdAt: integer('created_at').notNull()
})

export const benchmarkRunsTable = sqliteTable('benchmark_runs', {
  id: text('id').primaryKey(),
  model: text('model').notNull(),
  score: real('score').notNull(),
  maxScore: real('max_score').notNull(),
  percentage: real('percentage').notNull(),
  report: text('report_json', { mode: 'json' }).$type<BenchmarkReport>().notNull(),
  createdAt: integer('created_at').notNull()
})

export const fileSnapshotsTable = sqliteTable('file_snapshots', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  messageId: text('message_id'),
  toolCallId: text('tool_call_id'),
  path: text('path').notNull(),
  contentBefore: text('content_before'),
  contentAfter: text('content_after'),
  createdAt: integer('created_at').notNull()
})

export const messagesFtsTable = sqliteTable('messages_fts', {
  body: text('body'),
  messageId: text('message_id'),
  sessionId: text('session_id'),
  rank: real('rank')
})

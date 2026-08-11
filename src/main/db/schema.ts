import type BetterSqlite3 from 'better-sqlite3'
import { logger } from '../logger.js'

/**
 * Ordered list of migrations. Index + 1 is the resulting `user_version`, so a
 * migration is only ever appended — never edited once shipped.
 */
const MIGRATIONS: Array<(db: BetterSqlite3.Database) => void> = [
  // v1 — initial schema
  (db) => {
    db.exec(`
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        cwd         TEXT NOT NULL,
        model       TEXT,
        preset_id   TEXT,
        starred     INTEGER NOT NULL DEFAULT 0,
        forked_from TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE messages (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        role       TEXT NOT NULL,
        blocks     TEXT NOT NULL,
        model      TEXT,
        usage      TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_session ON messages(session_id, seq);

      -- Tool calls are denormalised out of the block array so they can be
      -- queried on their own (profiling, "what did the agent run" views).
      CREATE TABLE tool_calls (
        id          TEXT PRIMARY KEY,
        message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        session_id  TEXT NOT NULL,
        name        TEXT NOT NULL,
        input       TEXT NOT NULL,
        status      TEXT NOT NULL,
        result      TEXT,
        duration_ms INTEGER,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_tool_calls_session ON tool_calls(session_id, created_at);
      CREATE INDEX idx_tool_calls_message ON tool_calls(message_id);

      CREATE TABLE snippets (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        language   TEXT NOT NULL,
        code       TEXT NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE messages_fts USING fts5(
        body,
        message_id UNINDEXED,
        session_id UNINDEXED,
        tokenize = 'unicode61'
      );
    `)
  },

  // v2 — a tool-call id is unique within its message, not globally.
  //
  // Both id sources repeat across messages: the text protocol numbers calls
  // per run (`react_1_0`), and models routinely restart native ids at
  // `call_0` on every turn. The original global primary key made the second
  // assistant message in a session fail to save.
  (db) => {
    db.exec(`
      CREATE TABLE tool_calls_new (
        row_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        id          TEXT NOT NULL,
        message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        session_id  TEXT NOT NULL,
        name        TEXT NOT NULL,
        input       TEXT NOT NULL,
        status      TEXT NOT NULL,
        result      TEXT,
        duration_ms INTEGER,
        created_at  INTEGER NOT NULL,
        UNIQUE (message_id, id)
      );

      INSERT INTO tool_calls_new
        (id, message_id, session_id, name, input, status, result, duration_ms, created_at)
      SELECT id, message_id, session_id, name, input, status, result, duration_ms, created_at
        FROM tool_calls;

      DROP TABLE tool_calls;
      ALTER TABLE tool_calls_new RENAME TO tool_calls;

      CREATE INDEX idx_tool_calls_session ON tool_calls(session_id, created_at);
      CREATE INDEX idx_tool_calls_message ON tool_calls(message_id);
    `)
  },

  // v3 — effort and permission mode are per session, so switching projects
  // does not carry a "bypass everything" setting across with it.
  (db) => {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN effort TEXT NOT NULL DEFAULT 'high';
      ALTER TABLE sessions ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'manual';
    `)
  }
]

export function migrate(db: BetterSqlite3.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= MIGRATIONS.length) return

  for (let version = current; version < MIGRATIONS.length; version++) {
    const step = MIGRATIONS[version]
    if (!step) continue
    logger.info(`applying database migration ${version + 1}`)
    const run = db.transaction(() => {
      step(db)
      db.pragma(`user_version = ${version + 1}`)
    })
    run()
  }
}

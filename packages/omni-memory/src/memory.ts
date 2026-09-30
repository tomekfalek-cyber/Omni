import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type MemoryRole = 'system' | 'user' | 'assistant' | 'tool';

export interface MemoryRecord {
  id?: number;
  sessionId: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: number;
}

export interface MemorySearchResult extends MemoryRecord {
  /** FTS5 BM25 rank; lower is a better match. */
  score: number;
}

export interface MemoryStoreOptions {
  /** Database file path, or ':memory:' for an ephemeral database. */
  path?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL,
  role       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  metadata   TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_session
  ON memories (session_id, created_at DESC);

-- External-content FTS5 index over memories.content, kept in sync by triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  session_id UNINDEXED,
  content='memories',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts (rowid, content, session_id)
  VALUES (new.id, new.content, new.session_id);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts (memories_fts, rowid, content, session_id)
  VALUES ('delete', old.id, old.content, old.session_id);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts (memories_fts, rowid, content, session_id)
  VALUES ('delete', old.id, old.content, old.session_id);
  INSERT INTO memories_fts (rowid, content, session_id)
  VALUES (new.id, new.content, new.session_id);
END;

-- Key/value facts (long-term, structured knowledge).
CREATE TABLE IF NOT EXISTS facts (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

interface Row {
  id: number;
  session_id: string;
  role: string;
  content: string;
  metadata: string | null;
  created_at: number;
  score?: number;
}

function toRecord(row: Row): MemoryRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    createdAt: row.created_at,
  };
}

/** Turn a raw user query into a safe FTS5 MATCH expression (prefix search per term). */
function toMatchQuery(query: string): string {
  return query
    .replace(/["*()]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ');
}

/**
 * SQLite + FTS5 memory store built on Node's bundled `node:sqlite` module.
 * No native addon required — works on any Node 22+ install without a C toolchain.
 */
export class MemoryStore {
  protected readonly db: DatabaseSync;

  constructor(options: MemoryStoreOptions | string = {}) {
    const path = typeof options === 'string' ? options : options.path ?? ':memory:';
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  /** Insert one memory record and return its row id. */
  add(record: MemoryRecord): number {
    const info = this.db
      .prepare(
        'INSERT INTO memories (session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        record.sessionId,
        record.role,
        record.content,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.createdAt ?? Date.now()
      );
    return Number(info.lastInsertRowid);
  }

  /** Most recent records for a session, oldest-first. */
  recent(sessionId: string, limit = 20): MemoryRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(sessionId, limit) as unknown as Row[];
    return rows.reverse().map(toRecord);
  }

  /** Full-text search across all sessions (or one), best match first. */
  search(query: string, limit = 10, sessionId?: string): MemorySearchResult[] {
    const match = toMatchQuery(query);
    if (!match) return [];
    const rows = (sessionId
      ? this.db
          .prepare(
            `SELECT m.*, bm25(memories_fts) AS score
             FROM memories_fts
             JOIN memories m ON m.id = memories_fts.rowid
             WHERE memories_fts MATCH ? AND m.session_id = ?
             ORDER BY score LIMIT ?`
          )
          .all(match, sessionId, limit)
      : this.db
          .prepare(
            `SELECT m.*, bm25(memories_fts) AS score
             FROM memories_fts
             JOIN memories m ON m.id = memories_fts.rowid
             WHERE memories_fts MATCH ?
             ORDER BY score LIMIT ?`
          )
          .all(match, limit)) as unknown as Row[];
    return rows.map((row) => ({ ...toRecord(row), score: row.score ?? 0 }));
  }

  /** Total records, optionally scoped to a session. */
  count(sessionId?: string): number {
    const row = (sessionId
      ? this.db.prepare('SELECT COUNT(*) AS n FROM memories WHERE session_id = ?').get(sessionId)
      : this.db.prepare('SELECT COUNT(*) AS n FROM memories').get()) as unknown as { n: number };
    return row.n;
  }

  /** Delete every record for a session. Returns the number removed. */
  clear(sessionId: string): number {
    const info = this.db.prepare('DELETE FROM memories WHERE session_id = ?').run(sessionId);
    return Number(info.changes);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * High-level façade used by the swarm and the evolver.
 * Adds transcript appending and a key/value fact store on top of {@link MemoryStore}.
 */
export class OmniMemory extends MemoryStore {
  constructor(path: string = process.env.OMNI_MEMORY_DB ?? '.omni/memory/omni.db') {
    super(path);
  }

  /** Append a conversation/trace entry. `role` may be a custom agent role. */
  appendTranscript(sessionId: string, role: string, content: string): number {
    return this.add({ sessionId, role, content });
  }

  /** Insert or update a long-term fact. */
  saveFact(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO facts (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, Date.now());
  }

  /** Read a fact, or undefined when it was never stored. */
  getFact(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM facts WHERE key = ?').get(key) as
      | unknown as { value: string } | undefined;
    return row?.value;
  }

  /** All stored facts. */
  listFacts(): Array<{ key: string; value: string; updatedAt: number }> {
    const rows = this.db
      .prepare('SELECT key, value, updated_at FROM facts ORDER BY key')
      .all() as unknown as Array<{ key: string; value: string; updated_at: number }>;
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
  }
}

export function createMemoryStore(options?: MemoryStoreOptions | string): MemoryStore {
  return new MemoryStore(options);
}

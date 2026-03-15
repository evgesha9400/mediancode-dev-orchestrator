// mission-control/src/db.ts
import Database from "better-sqlite3";

export interface MissionControlDb {
  raw: Database.Database;
  close(): void;
}

export function createDatabase(path: string): MissionControlDb {
  const db = new Database(path);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
      current_stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      weight REAL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stage_progress (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      stage TEXT NOT NULL,
      step TEXT NOT NULL DEFAULT '__stage__',
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(feature_id, stage, step)
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      stage TEXT NOT NULL,
      step TEXT NOT NULL DEFAULT '__stage__',
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      stack TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feature_services (
      feature_id TEXT NOT NULL REFERENCES features(id),
      service_name TEXT NOT NULL REFERENCES services(name),
      status TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (feature_id, service_name)
    );

    CREATE TABLE IF NOT EXISTS document_paths (
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
      stage TEXT NOT NULL,
      step TEXT NOT NULL DEFAULT '__stage__',
      path TEXT NOT NULL,
      PRIMARY KEY (pipeline_id, stage, step)
    );
  `);

  return {
    raw: db,
    close() {
      db.close();
    },
  };
}

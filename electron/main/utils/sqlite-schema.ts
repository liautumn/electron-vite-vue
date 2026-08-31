import type Database from 'better-sqlite3'

const SCHEMA_SQL_LIST = [
  `
CREATE TABLE IF NOT EXISTS demo_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`,
]

export const initializeSqliteSchema = (sqlite: Database.Database) => {
  for (const sql of SCHEMA_SQL_LIST) {
    sqlite.exec(sql)
  }
}


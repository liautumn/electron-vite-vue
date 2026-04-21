import { app, ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createLogger, getLogDirectory } from '../utils/logger'
import type {
  SqliteBindValue,
  SqliteExecuteRequest,
  SqliteExecuteResult,
  SqliteRow,
} from '../../../shared/types/sqlite'
import { initializeSqliteSchema } from './sqlite-schema'

const DB_DIRECTORY = 'database'
const DB_FILENAME = 'app.sqlite3'

const log = createLogger('sqlite')
let sqliteRegistered = false
let beforeQuitHookRegistered = false
let sqlite: Database.Database | null = null

const resolvePackagedDatabaseDirectory = () =>
  path.join(path.dirname(getLogDirectory()), DB_DIRECTORY)

const resolveDatabaseDirectory = () => {
  if (app.isPackaged) {
    return resolvePackagedDatabaseDirectory()
  }

  return path.join(process.cwd(), DB_DIRECTORY)
}

const resolveDatabasePath = () =>
  path.join(resolveDatabaseDirectory(), DB_FILENAME)

const ensureDatabaseDirectory = () => {
  const directoryPath = resolveDatabaseDirectory()

  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true })
  }
}

const toLastInsertRowid = (
  value: number | bigint | null | undefined
): number | string | null => {
  if (value === null || value === undefined) return null

  if (typeof value === 'bigint') {
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? value.toString() : Number(value)
  }

  return value
}

const normalizeParams = (params: SqliteBindValue[] | undefined) =>
  Array.isArray(params) ? params : []

const ensureSqlite = () => {
  if (sqlite) return sqlite

  ensureDatabaseDirectory()
  const databasePath = resolveDatabasePath()

  const nextSqlite = new Database(databasePath)
  nextSqlite.pragma('journal_mode = WAL')
  nextSqlite.pragma('foreign_keys = ON')
  initializeSqliteSchema(nextSqlite)

  sqlite = nextSqlite

  log.info('SQLite initialized', { databasePath })
  return nextSqlite
}

const executeSql = (
  request: SqliteExecuteRequest
): SqliteExecuteResult<SqliteRow> => {
  const sql = request?.sql?.trim()
  if (!sql) throw new Error('SQL 不能为空')

  const db = ensureSqlite()
  const stmt = db.prepare(sql)
  const params = normalizeParams(request?.params)

  if (stmt.reader) {
    const rows = stmt.all(...params) as SqliteRow[]
    return {
      rows,
      changes: 0,
      lastInsertRowid: null,
    }
  }

  const runResult = stmt.run(...params)
  return {
    rows: [],
    changes: runResult.changes,
    lastInsertRowid: toLastInsertRowid(runResult.lastInsertRowid),
  }
}

const closeSqlite = () => {
  if (!sqlite) return

  sqlite.close()
  sqlite = null
  log.info('SQLite connection closed')
}

export function registerSqlite() {
  ensureSqlite()

  if (!beforeQuitHookRegistered) {
    app.on('before-quit', closeSqlite)
    beforeQuitHookRegistered = true
  }

  if (sqliteRegistered) return
  sqliteRegistered = true
  log.info('SQLite IPC handlers registered')

  ipcMain.handle('sqlite:execute', (_, request: SqliteExecuteRequest) => {
    try {
      return executeSql(request)
    } catch (error) {
      log.error('Failed to execute SQL', {
        sql: request?.sql,
        error,
      })
      throw error
    }
  })
}

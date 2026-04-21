export type SqliteBindValue = string | number | boolean | null | Uint8Array

export interface SqliteExecuteRequest {
  sql: string
  params?: SqliteBindValue[]
}

export type SqliteRow = Record<string, unknown>

export interface SqliteExecuteResult<T = SqliteRow> {
  rows: T[]
  changes: number
  lastInsertRowid: number | string | null
}

export interface SqliteMethods {
  execute<T = SqliteRow>(
    request: SqliteExecuteRequest
  ): Promise<SqliteExecuteResult<T>>
}

import { contextBridge, ipcRenderer } from 'electron'
import type { SqliteExecuteRequest, SqliteMethods } from '../../../shared/types/sqlite'

export function registerSqliteRenderer() {
  contextBridge.exposeInMainWorld('sqlite', {
    execute: (request: SqliteExecuteRequest) =>
      ipcRenderer.invoke('sqlite:execute', request),
  } as SqliteMethods)
}

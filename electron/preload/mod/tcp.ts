import { contextBridge, ipcRenderer } from 'electron'
import type {
  TcpApi,
  TcpConnectRequest,
  TcpDataEvent,
  TcpErrorEvent,
  TcpSession,
  TcpSessionEvent,
  TcpSessionId
} from '../../../shared/types/tcp'

const DEFAULT_TCP_SESSION_ID = 0

const normalizeSessionId = (value?: number) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_TCP_SESSION_ID
  }
  return parsed
}

const sessions = new Map<number, TcpSession>()

function createTcpSession(sessionId: TcpSessionId): TcpSession {
  const normalizedSessionId = normalizeSessionId(sessionId)

  return {
    sessionId: normalizedSessionId,

    disconnect: () => ipcRenderer.invoke('tcp:disconnect', normalizedSessionId),

    write: (hex: string) =>
      ipcRenderer.invoke('tcp:write', {
        hex,
        sessionId: normalizedSessionId
      }),

    onConnect: (cb: (payload: TcpSessionEvent) => void) => {
      const handler = (_event: unknown, payload: TcpSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:connect', handler)
      return () => ipcRenderer.off('tcp:connect', handler)
    },

    onClose: (cb: (payload: TcpSessionEvent) => void) => {
      const handler = (_event: unknown, payload: TcpSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:close', handler)
      return () => ipcRenderer.off('tcp:close', handler)
    },

    onData: (cb: (payload: TcpDataEvent) => void) => {
      const handler = (_event: unknown, payload: TcpDataEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:data', handler)
      return () => ipcRenderer.off('tcp:data', handler)
    },

    onError: (cb: (payload: TcpErrorEvent) => void) => {
      const handler = (_event: unknown, payload: TcpErrorEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:error', handler)
      return () => ipcRenderer.off('tcp:error', handler)
    }
  }
}

export function registerTcpRenderer() {
  const getSessionById = (sessionId: TcpSessionId) => {
    const normalizedSessionId = normalizeSessionId(sessionId)
    let session = sessions.get(normalizedSessionId)
    if (!session) {
      session = createTcpSession(normalizedSessionId)
      sessions.set(normalizedSessionId, session)
    }
    return session
  }

  const api: TcpApi = {
    connect: (options: TcpConnectRequest) => {
      const normalizedSessionId = normalizeSessionId(options?.sessionId)
      getSessionById(normalizedSessionId)
      return ipcRenderer.invoke('tcp:connect', {
        ...options,
        sessionId: normalizedSessionId
      })
    },

    getSessionById
  }

  contextBridge.exposeInMainWorld('tcp', api)
}

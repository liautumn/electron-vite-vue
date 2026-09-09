import { contextBridge, ipcRenderer } from 'electron'

export type TcpSessionId = number

export interface TcpConnectOptions {
  host: string
  port: number
}

export interface TcpConnectRequest extends TcpConnectOptions {
  sessionId?: TcpSessionId
}

export interface TcpSessionEvent {
  sessionId: TcpSessionId
}

export interface TcpDataEvent extends TcpSessionEvent {
  data: string
}

export interface TcpErrorEvent extends TcpSessionEvent {
  message: string
}

type TcpSession = ReturnType<typeof createTcpSession>

const DEFAULT_TCP_SESSION_ID = 0

const normalizeSessionId = (value?: number) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_TCP_SESSION_ID
  }
  return parsed
}

const sessions = new Map<number, TcpSession>()

function createTcpSession(sessionId: TcpSessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId)

  return {
    sessionId: normalizedSessionId,

    disconnect: (): Promise<boolean> => ipcRenderer.invoke('tcp:disconnect', normalizedSessionId),

    write: (hex: string): Promise<boolean> =>
      ipcRenderer.invoke('tcp:write', {
        hex,
        sessionId: normalizedSessionId
      }),

    onConnect: (cb: (payload: TcpSessionEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: TcpSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:connect', handler)
      return () => ipcRenderer.off('tcp:connect', handler)
    },

    onClose: (cb: (payload: TcpSessionEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: TcpSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:close', handler)
      return () => ipcRenderer.off('tcp:close', handler)
    },

    onData: (cb: (payload: TcpDataEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: TcpDataEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:data', handler)
      return () => ipcRenderer.off('tcp:data', handler)
    },

    onError: (cb: (payload: TcpErrorEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: TcpErrorEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('tcp:error', handler)
      return () => ipcRenderer.off('tcp:error', handler)
    }
  }
}

const getSessionById = (sessionId: TcpSessionId) => {
  const normalizedSessionId = normalizeSessionId(sessionId)
  let session = sessions.get(normalizedSessionId)
  if (!session) {
    session = createTcpSession(normalizedSessionId)
    sessions.set(normalizedSessionId, session)
  }
  return session
}

export const tcpApi = {
  connect: (options: TcpConnectRequest): Promise<boolean> => {
    const normalizedSessionId = normalizeSessionId(options?.sessionId)
    getSessionById(normalizedSessionId)
    return ipcRenderer.invoke('tcp:connect', {
      ...options,
      sessionId: normalizedSessionId
    })
  },

  getSessionById
}

export function registerTcpRenderer() {
  contextBridge.exposeInMainWorld('tcp', tcpApi)
}

import { contextBridge, ipcRenderer } from 'electron'

export type SerialSessionId = number

export interface SerialOpenOptions {
  path: string
  baudRate: number
}

export interface SerialOpenRequest extends SerialOpenOptions {
  sessionId?: SerialSessionId
}

export interface SerialSessionEvent {
  sessionId: SerialSessionId
}

export interface SerialDataEvent extends SerialSessionEvent {
  data: string
}

export interface SerialErrorEvent extends SerialSessionEvent {
  message: string
}

type SerialSession = ReturnType<typeof createSerialSession>

const DEFAULT_SERIAL_SESSION_ID = 0

const normalizeSessionId = (value?: number) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_SERIAL_SESSION_ID
  }
  return parsed
}

const sessions = new Map<number, SerialSession>()

function createSerialSession(sessionId: SerialSessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId)

  return {
    sessionId: normalizedSessionId,

    close: (): Promise<boolean> => ipcRenderer.invoke('serial:close', normalizedSessionId),

    write: (hex: string): Promise<boolean> =>
      ipcRenderer.invoke('serial:write', {
        hex,
        sessionId: normalizedSessionId
      }),

    onOpen: (cb: (payload: SerialSessionEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: SerialSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:open', handler)
      return () => ipcRenderer.off('serial:open', handler)
    },

    onClose: (cb: (payload: SerialSessionEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: SerialSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:close', handler)
      return () => ipcRenderer.off('serial:close', handler)
    },

    onData: (cb: (payload: SerialDataEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: SerialDataEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:data', handler)
      return () => ipcRenderer.off('serial:data', handler)
    },

    onError: (cb: (payload: SerialErrorEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: SerialErrorEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:error', handler)
      return () => ipcRenderer.off('serial:error', handler)
    }
  }
}

const getSessionById = (sessionId: SerialSessionId) => {
  const normalizedSessionId = normalizeSessionId(sessionId)
  let session = sessions.get(normalizedSessionId)
  if (!session) {
    session = createSerialSession(normalizedSessionId)
    sessions.set(normalizedSessionId, session)
  }
  return session
}

export const serialApi = {
  list: (): Promise<any[]> => ipcRenderer.invoke('serial:list'),

  open: (options: SerialOpenRequest): Promise<boolean> => {
    const normalizedSessionId = normalizeSessionId(options?.sessionId)
    getSessionById(normalizedSessionId)
    return ipcRenderer.invoke('serial:open', {
      ...options,
      sessionId: normalizedSessionId
    })
  },

  getSessionById
}

export function registerSerialRenderer() {
  contextBridge.exposeInMainWorld('serial', serialApi)
}

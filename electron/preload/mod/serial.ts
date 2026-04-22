import { contextBridge, ipcRenderer } from 'electron'
import type {
  SerialApi,
  SerialDataEvent,
  SerialErrorEvent,
  SerialOpenRequest,
  SerialSession,
  SerialSessionEvent,
  SerialSessionId
} from '../../../shared/types/serial'

const DEFAULT_SERIAL_SESSION_ID = 0

const normalizeSessionId = (value?: number) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_SERIAL_SESSION_ID
  }
  return parsed
}

const sessions = new Map<number, SerialSession>()

function createSerialSession(sessionId: SerialSessionId): SerialSession {
  const normalizedSessionId = normalizeSessionId(sessionId)

  return {
    sessionId: normalizedSessionId,

    close: () => ipcRenderer.invoke('serial:close', normalizedSessionId),

    write: (hex: string) =>
      ipcRenderer.invoke('serial:write', {
        hex,
        sessionId: normalizedSessionId
      }),

    onOpen: (cb: (payload: SerialSessionEvent) => void) => {
      const handler = (_event: unknown, payload: SerialSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:open', handler)
      return () => ipcRenderer.off('serial:open', handler)
    },

    onClose: (cb: (payload: SerialSessionEvent) => void) => {
      const handler = (_event: unknown, payload: SerialSessionEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:close', handler)
      return () => ipcRenderer.off('serial:close', handler)
    },

    onData: (cb: (payload: SerialDataEvent) => void) => {
      const handler = (_event: unknown, payload: SerialDataEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:data', handler)
      return () => ipcRenderer.off('serial:data', handler)
    },

    onError: (cb: (payload: SerialErrorEvent) => void) => {
      const handler = (_event: unknown, payload: SerialErrorEvent) => {
        if (payload?.sessionId !== normalizedSessionId) return
        cb(payload)
      }
      ipcRenderer.on('serial:error', handler)
      return () => ipcRenderer.off('serial:error', handler)
    }
  }
}

export function registerSerialRenderer() {
  const getSessionById = (sessionId: SerialSessionId) => {
    const normalizedSessionId = normalizeSessionId(sessionId)
    let session = sessions.get(normalizedSessionId)
    if (!session) {
      session = createSerialSession(normalizedSessionId)
      sessions.set(normalizedSessionId, session)
    }
    return session
  }

  const api: SerialApi = {
    list: () => ipcRenderer.invoke('serial:list'),

    open: (options: SerialOpenRequest) => {
      const normalizedSessionId = normalizeSessionId(options?.sessionId)
      getSessionById(normalizedSessionId)
      return ipcRenderer.invoke('serial:open', {
        ...options,
        sessionId: normalizedSessionId
      })
    },

    getSessionById
  }

  contextBridge.exposeInMainWorld('serial', api)
}

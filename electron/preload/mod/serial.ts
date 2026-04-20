import {contextBridge, ipcRenderer} from 'electron'
import {SerialMethods} from '../../../shared/types/serial';

const DEFAULT_SERIAL_SESSION_ID = 0

const resolveSessionId = (sessionId?: number) =>
  Number.isInteger(sessionId) ? Number(sessionId) : DEFAULT_SERIAL_SESSION_ID

export function registerSerialRenderer() {
  contextBridge.exposeInMainWorld('serial', {
    list: () => ipcRenderer.invoke('serial:list'),

    open: (options: { sessionId?: number; path: string; baudRate: number }) =>
      ipcRenderer.invoke('serial:open', {
        ...options,
        sessionId: resolveSessionId(options?.sessionId)
      }),

    close: (sessionId = DEFAULT_SERIAL_SESSION_ID) =>
      ipcRenderer.invoke('serial:close', resolveSessionId(sessionId)),

    write: (hex: string, sessionId = DEFAULT_SERIAL_SESSION_ID) =>
      ipcRenderer.invoke('serial:write', {
        hex,
        sessionId: resolveSessionId(sessionId)
      }),

    onOpen: (cb: (_: any, payload: { sessionId: number }) => void) => {
      ipcRenderer.on('serial:open', cb)
      return () => ipcRenderer.off('serial:open', cb)
    },

    onClose: (cb: (_: any, payload: { sessionId: number }) => void) => {
      ipcRenderer.on('serial:close', cb)
      return () => ipcRenderer.off('serial:close', cb)
    },

    onData: (cb: (_: any, payload: { sessionId: number; data: string }) => void) => {
      ipcRenderer.on('serial:data', cb)
      return () => ipcRenderer.off('serial:data', cb)
    },

    onError: (cb: (_: any, payload: { sessionId: number; message: string }) => void) => {
      ipcRenderer.on('serial:error', cb)
      return () => ipcRenderer.off('serial:error', cb)
    },
  } as SerialMethods)
}

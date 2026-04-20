import {contextBridge, ipcRenderer} from "electron";
import {TcpMethods} from '../../../shared/types/tcp';

const DEFAULT_TCP_SESSION_ID = 0

const resolveSessionId = (sessionId?: number) =>
    Number.isInteger(sessionId) ? Number(sessionId) : DEFAULT_TCP_SESSION_ID

export function registerTcpRenderer() {
    contextBridge.exposeInMainWorld('tcp', {
        connect: (options: { sessionId?: number; host: string; port: number }) =>
            ipcRenderer.invoke('tcp:connect', {
                ...options,
                sessionId: resolveSessionId(options?.sessionId)
            }),

        disconnect: (sessionId = DEFAULT_TCP_SESSION_ID) =>
            ipcRenderer.invoke('tcp:disconnect', resolveSessionId(sessionId)),

        write: (hex: string, sessionId = DEFAULT_TCP_SESSION_ID) =>
            ipcRenderer.invoke('tcp:write', {
                hex,
                sessionId: resolveSessionId(sessionId)
            }),

        onConnect: (cb: (_: any, payload: { sessionId: number }) => void) => {
            ipcRenderer.on('tcp:connect', cb)
            return () => ipcRenderer.off('tcp:connect', cb)
        },

        onClose: (cb: (_: any, payload: { sessionId: number }) => void) => {
            ipcRenderer.on('tcp:close', cb)
            return () => ipcRenderer.off('tcp:close', cb)
        },

        onData: (cb: (_: any, payload: { sessionId: number; data: string }) => void) => {
            ipcRenderer.on('tcp:data', cb)
            return () => ipcRenderer.off('tcp:data', cb)
        },

        onError: (cb: (_: any, payload: { sessionId: number; message: string }) => void) => {
            ipcRenderer.on('tcp:error', cb)
            return () => ipcRenderer.off('tcp:error', cb)
        },
    } as TcpMethods)
}

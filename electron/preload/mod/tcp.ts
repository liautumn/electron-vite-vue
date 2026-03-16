import {contextBridge, ipcRenderer} from "electron";
import {TcpMethods} from '../../../shared/types/tcp';

export function registerTcpRenderer() {
    contextBridge.exposeInMainWorld('tcp', {
        connect: (options: { host: string; port: number }) =>
            ipcRenderer.invoke('tcp:connect', options),

        disconnect: () => ipcRenderer.invoke('tcp:disconnect'),

        write: (hex: string) => ipcRenderer.invoke('tcp:write', hex),

        onConnect: (cb: () => void) =>
            ipcRenderer.on('tcp:connect', cb),

        onClose: (cb: () => void) =>
            ipcRenderer.on('tcp:close', cb),

        onData: (cb: (_: any, data: string) => void) =>
            ipcRenderer.on('tcp:data', cb),

        onError: (cb: (_: any, msg: string) => void) =>
            ipcRenderer.on('tcp:error', cb),
    } as TcpMethods)
}

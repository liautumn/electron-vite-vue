import {contextBridge, ipcRenderer} from 'electron'

export function registerSerialRenderer() {
  contextBridge.exposeInMainWorld('serial', {
    list: () => ipcRenderer.invoke('serial:list'),

    open: (options: { path: string; baudRate: number }) =>
      ipcRenderer.invoke('serial:open', options),

    close: () => ipcRenderer.invoke('serial:close'),

    write: (hex: string) => ipcRenderer.invoke('serial:write', hex),

    onOpen: (cb: () => void) =>
      ipcRenderer.on('serial:open', cb),

    onClose: (cb: () => void) =>
      ipcRenderer.on('serial:close', cb),

    onData: (cb: (_: any, data: string) => void) =>
      ipcRenderer.on('serial:data', cb),

    onError: (cb: (_: any, msg: string) => void) =>
      ipcRenderer.on('serial:error', cb),
  })
}

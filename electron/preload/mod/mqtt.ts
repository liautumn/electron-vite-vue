import {contextBridge, ipcRenderer} from 'electron'

export function registerMqttRenderer() {
  contextBridge.exposeInMainWorld('mqtt', {
    connect: (options: {
      url: string
      clientId?: string
      username?: string
      password?: string
      clean?: boolean
      reconnectPeriod?: number
      connectTimeout?: number
    }) => ipcRenderer.invoke('mqtt:connect', options),

    disconnect: () => ipcRenderer.invoke('mqtt:disconnect'),

    subscribe: (options: { topic: string; qos?: 0 | 1 | 2 }) =>
      ipcRenderer.invoke('mqtt:subscribe', options),

    unsubscribe: (topic: string) =>
      ipcRenderer.invoke('mqtt:unsubscribe', topic),

    publish: (options: {
      topic: string
      payload: string
      qos?: 0 | 1 | 2
      retain?: boolean
    }) => ipcRenderer.invoke('mqtt:publish', options),

    onConnect: (cb: () => void) => {
      ipcRenderer.on('mqtt:connect', cb)
      return () => ipcRenderer.off('mqtt:connect', cb)
    },

    onReconnect: (cb: () => void) => {
      ipcRenderer.on('mqtt:reconnect', cb)
      return () => ipcRenderer.off('mqtt:reconnect', cb)
    },

    onOffline: (cb: () => void) => {
      ipcRenderer.on('mqtt:offline', cb)
      return () => ipcRenderer.off('mqtt:offline', cb)
    },

    onClose: (cb: () => void) => {
      ipcRenderer.on('mqtt:close', cb)
      return () => ipcRenderer.off('mqtt:close', cb)
    },

    onError: (cb: (_: any, msg: string) => void) => {
      ipcRenderer.on('mqtt:error', cb)
      return () => ipcRenderer.off('mqtt:error', cb)
    },

    onMessage: (cb: (_: any, message: {
      topic: string
      payloadText: string
      payloadHex: string
      qos: 0 | 1 | 2
      retain: boolean
      dup: boolean
      timestamp: string
    }) => void) => {
      ipcRenderer.on('mqtt:message', cb)
      return () => ipcRenderer.off('mqtt:message', cb)
    },
  })
}

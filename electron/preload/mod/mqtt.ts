import {contextBridge, ipcRenderer} from 'electron'
import type {IpcRendererEvent} from 'electron'

export type MqttQoS = 0 | 1 | 2

export interface MqttConnectOptions {
  url: string
  clientId?: string
  username?: string
  password?: string
  clean?: boolean
  reconnectPeriod?: number
  connectTimeout?: number
}

export interface MqttSubscribeOptions {
  topic: string
  qos?: MqttQoS
}

export interface MqttPublishOptions {
  topic: string
  payload: string
  qos?: MqttQoS
  retain?: boolean
}

export interface MqttSubscriptionGrant {
  topic: string
  qos: MqttQoS | 128
}

export interface MqttMessageEvent {
  topic: string
  payloadText: string
  payloadHex: string
  qos: MqttQoS
  retain: boolean
  dup: boolean
  timestamp: string
}

export const mqttApi = {
  connect: (options: MqttConnectOptions): Promise<boolean> => ipcRenderer.invoke('mqtt:connect', options),

  disconnect: (): Promise<boolean> => ipcRenderer.invoke('mqtt:disconnect'),

  subscribe: (options: MqttSubscribeOptions): Promise<MqttSubscriptionGrant[]> =>
    ipcRenderer.invoke('mqtt:subscribe', options),

  unsubscribe: (topic: string): Promise<boolean> => ipcRenderer.invoke('mqtt:unsubscribe', topic),

  publish: (options: MqttPublishOptions): Promise<boolean> => ipcRenderer.invoke('mqtt:publish', options),

  onConnect: (cb: () => void): (() => void) => {
    ipcRenderer.on('mqtt:connect', cb)
    return () => ipcRenderer.off('mqtt:connect', cb)
  },

  onReconnect: (cb: () => void): (() => void) => {
    ipcRenderer.on('mqtt:reconnect', cb)
    return () => ipcRenderer.off('mqtt:reconnect', cb)
  },

  onOffline: (cb: () => void): (() => void) => {
    ipcRenderer.on('mqtt:offline', cb)
    return () => ipcRenderer.off('mqtt:offline', cb)
  },

  onClose: (cb: () => void): (() => void) => {
    ipcRenderer.on('mqtt:close', cb)
    return () => ipcRenderer.off('mqtt:close', cb)
  },

  onError: (cb: (event: IpcRendererEvent, msg: string) => void): (() => void) => {
    ipcRenderer.on('mqtt:error', cb)
    return () => ipcRenderer.off('mqtt:error', cb)
  },

  onMessage: (cb: (event: IpcRendererEvent, message: MqttMessageEvent) => void): (() => void) => {
    ipcRenderer.on('mqtt:message', cb)
    return () => ipcRenderer.off('mqtt:message', cb)
  },
}

export function registerMqttRenderer() {
  contextBridge.exposeInMainWorld('mqtt', mqttApi)
}

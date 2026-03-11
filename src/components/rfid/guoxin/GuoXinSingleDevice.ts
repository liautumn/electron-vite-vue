import { normalizeHex } from './GuoXinCommon'

export type GuoxinConnectionMode = 'serial' | 'tcp'

type GuoXinEventName = 'GuoXin_Data'
type GuoXinDataListener = (data: string) => void
type GuoXinRawDataListener = (source: GuoxinConnectionMode, data: string) => void
type GuoXinStatusListener = (state: GuoxinDeviceSnapshot) => void

export interface GuoxinDeviceConfig {
  antType?: number
  antStay?: number[]
}

export interface GuoxinDeviceSnapshot {
  mode: GuoxinConnectionMode
  connected: boolean
  antType: number
  antStay: number[]
  lastError: string | null
}

class GuoXinSingleDevice {
  private initialized = false
  private mode: GuoxinConnectionMode = 'tcp'
  private connected = false
  private antType = 4
  private antStay: number[] = []
  private lastError: string | null = null
  private rxBuffers: Record<GuoxinConnectionMode, string> = {
    serial: '',
    tcp: ''
  }
  private commandDataListeners = new Set<GuoXinDataListener>()
  private rawDataListeners = new Set<GuoXinRawDataListener>()
  private statusListeners = new Set<GuoXinStatusListener>()

  get ant_type() {
    return this.antType
  }

  get ant_stay() {
    return this.antStay
  }

  get currentMode() {
    return this.mode
  }

  get isConnected() {
    return this.connected
  }

  configure(config: GuoxinDeviceConfig) {
    if (typeof config.antType === 'number') {
      this.antType = config.antType
    }
    if (Array.isArray(config.antStay)) {
      this.antStay = [...config.antStay]
    }
    this.emitStatus()
  }

  getSnapshot(): GuoxinDeviceSnapshot {
    return {
      mode: this.mode,
      connected: this.connected,
      antType: this.antType,
      antStay: [...this.antStay],
      lastError: this.lastError
    }
  }

  subscribeStatus(listener: GuoXinStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeRawData(listener: GuoXinRawDataListener) {
    this.ensureInitialized()
    this.rawDataListeners.add(listener)
    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  setMode(mode: GuoxinConnectionMode) {
    this.ensureInitialized()
    this.mode = mode
    this.connected = false
    this.lastError = null
    this.resetRxBuffers()
    this.emitStatus()
  }

  async connectSerial(options: { path: string; baudRate: number }) {
    this.ensureInitialized()
    this.mode = 'serial'
    this.lastError = null
    this.resetRxBuffer('serial')
    this.emitStatus()
    await window.serial.open(options)
  }

  async connectTcp(options: { host: string; port: number }) {
    this.ensureInitialized()
    this.mode = 'tcp'
    this.lastError = null
    this.resetRxBuffer('tcp')
    this.emitStatus()
    await window.tcp.connect(options)
  }

  async disconnect(mode: GuoxinConnectionMode = this.mode) {
    this.ensureInitialized()
    if (mode === 'serial') {
      await window.serial.close()
    } else {
      await window.tcp.disconnect()
    }
    this.resetRxBuffer(mode)
    if (this.mode === mode) {
      this.connected = false
      this.emitStatus()
    }
  }

  sendMessageNew(hex: string) {
    this.ensureInitialized()
    if (!this.connected) {
      throw new Error('国芯 RFID 设备未连接')
    }
    const payload = normalizeHex(hex)
    if (this.mode === 'serial') {
      void window.serial.write(payload)
      return
    }
    void window.tcp.write(payload)
  }

  on(eventName: GuoXinEventName, listener: GuoXinDataListener) {
    this.ensureInitialized()
    if (eventName !== 'GuoXin_Data') return
    this.commandDataListeners.add(listener)
  }

  off(eventName: GuoXinEventName, listener?: GuoXinDataListener) {
    if (eventName !== 'GuoXin_Data') return
    if (listener) {
      this.commandDataListeners.delete(listener)
      return
    }
    this.commandDataListeners.clear()
  }

  private ensureInitialized() {
    if (this.initialized) return
    this.initialized = true

    window.ipcRenderer.on('serial:open', () => {
      if (this.mode !== 'serial') return
      this.connected = true
      this.lastError = null
      this.emitStatus()
    })
    window.ipcRenderer.on('serial:close', () => {
      if (this.mode !== 'serial') return
      this.connected = false
      this.resetRxBuffer('serial')
      this.emitStatus()
    })
    window.ipcRenderer.on('serial:error', (_, message: string) => {
      if (this.mode !== 'serial') return
      this.connected = false
      this.lastError = message
      this.resetRxBuffer('serial')
      this.emitStatus()
    })
    window.ipcRenderer.on('serial:data', (_, data: string) => {
      this.emitData('serial', data)
    })

    window.ipcRenderer.on('tcp:connect', () => {
      if (this.mode !== 'tcp') return
      this.connected = true
      this.lastError = null
      this.emitStatus()
    })
    window.ipcRenderer.on('tcp:close', () => {
      if (this.mode !== 'tcp') return
      this.connected = false
      this.resetRxBuffer('tcp')
      this.emitStatus()
    })
    window.ipcRenderer.on('tcp:error', (_, message: string) => {
      if (this.mode !== 'tcp') return
      this.connected = false
      this.lastError = message
      this.resetRxBuffer('tcp')
      this.emitStatus()
    })
    window.ipcRenderer.on('tcp:data', (_, data: string) => {
      this.emitData('tcp', data)
    })
  }

  private emitData(source: GuoxinConnectionMode, data: string) {
    const frames = this.handleNewRx(source, data)
    if (!frames.length) return

    frames.forEach((frame) => {
      this.rawDataListeners.forEach((listener) => {
        listener(source, frame)
      })

      if (source !== this.mode) return

      this.commandDataListeners.forEach((listener) => {
        listener(frame)
      })
    })
  }

  private emitStatus() {
    const snapshot = this.getSnapshot()
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  private handleNewRx(source: GuoxinConnectionMode, data: string) {
    const normalized = normalizeHex(String(data ?? ''))
    if (!normalized) {
      return []
    }

    // Serial/TCP may split or merge protocol frames, so reassemble before dispatch.
    let buffer = (this.rxBuffers[source] || '') + normalized
    const frames: string[] = []

    while (true) {
      const startIndex = buffer.indexOf('5A')
      if (startIndex === -1) {
        buffer = ''
        break
      }
      if (startIndex > 0) {
        buffer = buffer.slice(startIndex)
      }
      if (buffer.length < 14) {
        break
      }

      const lengthHex = buffer.slice(10, 14)
      const payloadLength = parseInt(lengthHex, 16)
      if (Number.isNaN(payloadLength)) {
        buffer = buffer.slice(2)
        continue
      }

      const frameLength = 18 + payloadLength * 2
      if (buffer.length < frameLength) {
        break
      }

      frames.push(buffer.slice(0, frameLength))
      buffer = buffer.slice(frameLength)
    }

    this.rxBuffers[source] = buffer
    return frames
  }

  private resetRxBuffer(mode: GuoxinConnectionMode) {
    this.rxBuffers[mode] = ''
  }

  private resetRxBuffers() {
    this.resetRxBuffer('serial')
    this.resetRxBuffer('tcp')
  }
}

export const guoxinSingleDevice = new GuoXinSingleDevice()

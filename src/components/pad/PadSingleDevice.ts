import {
  extractPadFixedLengthFrames,
  normalizePadHex,
  requirePadHexPayload,
  parsePadFrame,
  type PadParsedFrame
} from './PadProtocol'

type PadStatusListener = (snapshot: PadDeviceSnapshot) => void
type PadRawDataListener = (data: string) => void
type PadFrameListener = (frame: PadParsedFrame) => void

export interface PadDeviceSnapshot {
  connected: boolean
  portPath: string
  baudRate: number
  lastError: string | null
}

export interface PadRawResponseOptions {
  timeout?: number
  idleMs?: number
  optional?: boolean
}

class PadSingleDevice {
  private initialized = false

  private connected = false

  private portPath = ''

  private baudRate = 9600

  private lastError: string | null = null

  private fixedFrameBuffer = ''

  private statusListeners = new Set<PadStatusListener>()

  private rawDataListeners = new Set<PadRawDataListener>()

  private frameListeners = new Set<PadFrameListener>()

  getSnapshot(): PadDeviceSnapshot {
    return {
      connected: this.connected,
      portPath: this.portPath,
      baudRate: this.baudRate,
      lastError: this.lastError
    }
  }

  async listPorts() {
    return window.serial.list()
  }

  subscribeStatus(listener: PadStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeRawData(listener: PadRawDataListener) {
    this.ensureInitialized()
    this.rawDataListeners.add(listener)
    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  subscribeFrame(listener: PadFrameListener) {
    this.ensureInitialized()
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  async connectSerial(options: { path: string; baudRate: number }) {
    this.ensureInitialized()
    this.portPath = options.path
    this.baudRate = options.baudRate
    this.connected = false
    this.lastError = null
    this.resetRxBuffer()
    this.emitStatus()
    await window.serial.open(options)
  }

  async disconnect() {
    this.ensureInitialized()
    await window.serial.close()
    this.connected = false
    this.resetRxBuffer()
    this.emitStatus()
  }

  async sendHex(hex: string) {
    this.ensureInitialized()
    if (!this.connected) {
      throw new Error('PAD 锁控板未连接')
    }
    const payload = requirePadHexPayload(hex)
    await window.serial.write(payload)
  }

  async requestFrame(
    send: () => Promise<void> | void,
    matcher: (frame: PadParsedFrame) => boolean,
    timeout = 2000
  ) {
    this.ensureInitialized()

    return await new Promise<PadParsedFrame>(async (resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      const cleanup = (dispose: () => void) => {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
        dispose()
      }

      const dispose = this.subscribeFrame((frame) => {
        if (!matcher(frame)) {
          return
        }
        cleanup(dispose)
        resolve(frame)
      })

      timer = setTimeout(() => {
        cleanup(dispose)
        reject(new Error(`等待 PAD 固定响应超时(${timeout}ms)`))
      }, timeout)

      try {
        await send()
      } catch (error) {
        cleanup(dispose)
        reject(error)
      }
    })
  }

  async requestRawResponse(
    send: () => Promise<void> | void,
    options: PadRawResponseOptions = {}
  ) {
    this.ensureInitialized()

    const { timeout = 2000, idleMs = 120, optional = false } = options

    return await new Promise<string>(async (resolve, reject) => {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      let responseHex = ''

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
          timeoutTimer = undefined
        }
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = undefined
        }
        dispose()
      }

      const finish = (result: 'success' | 'timeout' | 'error', error?: Error) => {
        cleanup()

        if (result === 'success') {
          resolve(responseHex)
          return
        }

        if (result === 'timeout' && optional) {
          resolve('')
          return
        }

        reject(error ?? new Error(`等待 PAD 原始响应超时(${timeout}ms)`))
      }

      const scheduleIdleFinish = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
        }
        idleTimer = setTimeout(() => {
          finish('success')
        }, idleMs)
      }

      const dispose = this.subscribeRawData((chunk) => {
        responseHex += chunk
        scheduleIdleFinish()
      })

      timeoutTimer = setTimeout(() => {
        if (responseHex) {
          finish('success')
          return
        }
        finish('timeout', new Error(`等待 PAD 原始响应超时(${timeout}ms)`))
      }, timeout)

      try {
        await send()
      } catch (error) {
        finish('error', error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private ensureInitialized() {
    if (this.initialized) {
      return
    }

    this.initialized = true

    window.ipcRenderer.on('serial:open', () => {
      this.connected = true
      this.lastError = null
      this.emitStatus()
    })

    window.ipcRenderer.on('serial:close', () => {
      this.connected = false
      this.resetRxBuffer()
      this.emitStatus()
    })

    window.ipcRenderer.on('serial:error', (_, message: string) => {
      this.connected = false
      this.lastError = message
      this.resetRxBuffer()
      this.emitStatus()
    })

    window.ipcRenderer.on('serial:data', (_, data: string) => {
      this.handleIncomingData(data)
    })
  }

  private emitStatus() {
    const snapshot = this.getSnapshot()
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  private handleIncomingData(data: string) {
    const normalized = normalizePadHex(data)
    if (!normalized) {
      return
    }

    this.rawDataListeners.forEach((listener) => {
      listener(normalized)
    })

    this.fixedFrameBuffer += normalized

    const extracted = extractPadFixedLengthFrames(this.fixedFrameBuffer)
    this.fixedFrameBuffer = extracted.rest

    extracted.frames.forEach((frameHex) => {
      const frame = parsePadFrame(frameHex)
      if (!frame) {
        return
      }
      this.frameListeners.forEach((listener) => {
        listener(frame)
      })
    })
  }

  private resetRxBuffer() {
    this.fixedFrameBuffer = ''
  }
}

export const padSingleDevice = new PadSingleDevice()

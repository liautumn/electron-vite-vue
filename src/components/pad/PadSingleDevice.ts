import {
  extractPadFixedLengthFrames,
  normalizePadHex,
  requirePadHexPayload,
  parsePadFrame,
  type PadParsedFrame
} from './PadProtocol'
import type { IpcRendererEvent } from 'electron'

type SerialSessionEvent = {
  sessionId: number
}

type SerialDataEvent = SerialSessionEvent & {
  data: string
}

type SerialErrorEvent = SerialSessionEvent & {
  message: string
}

// 设备状态、原始数据、结构化帧三类订阅回调。
type PadStatusListener = (snapshot: PadDeviceSnapshot) => void
type PadRawDataListener = (data: string) => void
type PadFrameListener = (frame: PadParsedFrame) => void

// 页面感知到的 PAD 设备快照。
export interface PadDeviceSnapshot {
  connected: boolean
  portPath: string
  baudRate: number
  lastError: string | null
}

// 原始响应等待参数，主要给 9A/9B 这类长度不稳定的指令使用。
export interface PadRawResponseOptions {
  timeout?: number
  idleMs?: number
  optional?: boolean
}

const PAD_SESSION_ID = 0

class PadSingleDevice {
  // 避免重复绑定 Electron 事件。
  private initialized = false

  // 当前是否处于串口已连接状态。
  private connected = false

  // 当前连接使用的串口路径。
  private portPath = ''

  // 当前连接使用的波特率。
  private baudRate = 9600

  // 最近一次串口错误。
  private lastError: string | null = null

  // 固定长度响应的半包缓冲。
  private fixedFrameBuffer = ''

  // 各类订阅器集合。
  private statusListeners = new Set<PadStatusListener>()

  private rawDataListeners = new Set<PadRawDataListener>()

  private frameListeners = new Set<PadFrameListener>()

  // 对外返回当前设备状态快照。
  getSnapshot(): PadDeviceSnapshot {
    return {
      connected: this.connected,
      portPath: this.portPath,
      baudRate: this.baudRate,
      lastError: this.lastError
    }
  }

  // 透传串口列表查询，页面用于选择连接目标。
  async listPorts() {
    return window.serial.list()
  }

  // 订阅设备状态，订阅后立即回推一次当前状态。
  subscribeStatus(listener: PadStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  // 订阅原始 HEX 数据，便于保留原始收包内容。
  subscribeRawData(listener: PadRawDataListener) {
    this.ensureInitialized()
    this.rawDataListeners.add(listener)
    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  // 订阅已经解析完成的固定长度帧。
  subscribeFrame(listener: PadFrameListener) {
    this.ensureInitialized()
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  // 连接串口并刷新当前设备上下文。
  async connectSerial(options: { path: string; baudRate: number }) {
    this.ensureInitialized()
    this.portPath = options.path
    this.baudRate = options.baudRate
    this.connected = false
    this.lastError = null
    this.resetRxBuffer()
    this.emitStatus()
    await window.serial.open({
      sessionId: PAD_SESSION_ID,
      ...options
    })
  }

  // 主动断开串口连接。
  async disconnect() {
    this.ensureInitialized()
    await window.serial.close(PAD_SESSION_ID)
    this.connected = false
    this.resetRxBuffer()
    this.emitStatus()
  }

  // 发送一条完整 HEX 指令。
  async sendHex(hex: string) {
    this.ensureInitialized()
    if (!this.connected) {
      throw new Error('PAD 锁控板未连接')
    }
    const payload = requirePadHexPayload(hex)
    await window.serial.write(payload, PAD_SESSION_ID)
  }

  // 等待一条固定长度且满足条件的响应帧。
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

  // 等待一段原始响应数据，适合 9A/9B 这种长度不稳定的命令。
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

      // 清理所有等待计时器和订阅器。
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

      // 根据结束原因统一完成这次等待。
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

      // 只要仍有新数据进来，就继续向后延迟完成时机。
      const scheduleIdleFinish = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
        }
        idleTimer = setTimeout(() => {
          finish('success')
        }, idleMs)
      }

      // 收到的原始 chunk 会直接累加起来返回给上层。
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

  // 延迟完成 Electron 事件绑定，保证全局只初始化一次。
  private ensureInitialized() {
    if (this.initialized) {
      return
    }

    this.initialized = true

    // 串口连接成功。
    window.serial.onOpen((_event: IpcRendererEvent, payload: SerialSessionEvent) => {
      if (payload.sessionId !== PAD_SESSION_ID) {
        return
      }

      this.connected = true
      this.lastError = null
      this.emitStatus()
    })

    // 串口关闭。
    window.serial.onClose((_event: IpcRendererEvent, payload: SerialSessionEvent) => {
      if (payload.sessionId !== PAD_SESSION_ID) {
        return
      }

      this.connected = false
      this.resetRxBuffer()
      this.emitStatus()
    })

    // 串口错误。
    window.serial.onError((_event: IpcRendererEvent, payload: SerialErrorEvent) => {
      if (payload.sessionId !== PAD_SESSION_ID) {
        return
      }

      const { message } = payload

      this.connected = false
      this.lastError = message
      this.resetRxBuffer()
      this.emitStatus()
    })

    // 串口收到数据后统一交给接收入口处理。
    window.serial.onData((_event: IpcRendererEvent, payload: SerialDataEvent) => {
      if (payload.sessionId !== PAD_SESSION_ID) {
        return
      }

      this.handleIncomingData(payload.data)
    })
  }

  // 向所有状态订阅者广播当前快照。
  private emitStatus() {
    const snapshot = this.getSnapshot()
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  // 处理新收到的原始串口数据：先转 HEX，再拆固定长度响应。
  private handleIncomingData(data: string) {
    const normalized = normalizePadHex(data)
    if (!normalized) {
      return
    }

    this.rawDataListeners.forEach((listener) => {
      listener(normalized)
    })

    // 固定长度帧按缓冲区方式处理，解决半包和粘包问题。
    this.fixedFrameBuffer += normalized

    const extracted = extractPadFixedLengthFrames(this.fixedFrameBuffer)
    this.fixedFrameBuffer = extracted.rest

    // 逐帧解析成功后再分发给业务订阅者。
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

  // 清空固定长度响应的半包缓冲。
  private resetRxBuffer() {
    this.fixedFrameBuffer = ''
  }
}

// PAD 设备在页面层只维护一个单例即可。
export const padSingleDevice = new PadSingleDevice()

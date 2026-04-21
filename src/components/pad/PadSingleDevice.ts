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
type PadRawDataListener = (sessionId: number, data: string) => void
type PadFrameListener = (sessionId: number, frame: PadParsedFrame) => void

// 页面感知到的 PAD 设备快照。
export interface PadDeviceSnapshot {
  sessionId: number
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

type PadSessionState = {
  connected: boolean
  portPath: string
  baudRate: number
  lastError: string | null
  fixedFrameBuffer: string
}

const DEFAULT_PAD_SESSION_ID = 0
const DEFAULT_PAD_BAUD_RATE = 9600

const normalizeSessionId = (sessionId?: number) => {
  const parsed = Number(sessionId)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_PAD_SESSION_ID
  }
  return parsed
}

const createSessionState = (): PadSessionState => ({
  connected: false,
  portPath: '',
  baudRate: DEFAULT_PAD_BAUD_RATE,
  lastError: null,
  fixedFrameBuffer: ''
})

class PadSingleDevice {
  // 避免重复绑定 Electron 事件。
  private initialized = false

  // 当前激活会话 ID，供未显式传参的方法兜底使用。
  private activeSessionId = DEFAULT_PAD_SESSION_ID

  // 会话状态池。
  private sessionStates = new Map<number, PadSessionState>()

  // 各类订阅器集合。
  private statusListeners = new Set<PadStatusListener>()
  private rawDataListeners = new Set<PadRawDataListener>()
  private frameListeners = new Set<PadFrameListener>()

  // 切换当前激活会话。
  setActiveSession(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.getSessionState(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  // 对外返回指定会话状态快照。
  getSnapshot(sessionId = this.activeSessionId): PadDeviceSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionState(targetSessionId)

    return {
      sessionId: targetSessionId,
      connected: state.connected,
      portPath: state.portPath,
      baudRate: state.baudRate,
      lastError: state.lastError
    }
  }

  // 返回当前所有已初始化会话快照。
  getSnapshots() {
    if (!this.sessionStates.size) {
      return [this.getSnapshot(this.activeSessionId)]
    }

    return Array.from(this.sessionStates.keys())
      .sort((a, b) => a - b)
      .map((sessionId) => this.getSnapshot(sessionId))
  }

  // 透传串口列表查询，页面用于选择连接目标。
  async listPorts() {
    return window.serial.list()
  }

  // 订阅设备状态，订阅后立即回推一次当前激活会话状态。
  subscribeStatus(listener: PadStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)
    listener(this.getSnapshot(this.activeSessionId))
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

  // 连接串口并刷新指定会话上下文。
  async connectSerial(options: { sessionId?: number; path: string; baudRate: number }) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(options.sessionId)
    this.activeSessionId = targetSessionId

    const state = this.getSessionState(targetSessionId)

    if (state.connected) {
      await this.disconnect(targetSessionId)
    }

    state.portPath = options.path
    state.baudRate = options.baudRate
    state.connected = false
    state.lastError = null
    this.resetRxBuffer(targetSessionId)
    this.emitStatus(targetSessionId)

    await window.serial.open({
      sessionId: targetSessionId,
      path: options.path,
      baudRate: options.baudRate
    })
  }

  // 主动断开指定会话串口连接。
  async disconnect(sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId

    await window.serial.close(targetSessionId)

    const state = this.getSessionState(targetSessionId)
    state.connected = false
    this.resetRxBuffer(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  // 按指定会话发送一条完整 HEX 指令。
  async sendHex(hex: string, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId

    const state = this.getSessionState(targetSessionId)
    if (!state.connected) {
      throw new Error(`PAD 会话[${targetSessionId}]未连接`)
    }

    const payload = requirePadHexPayload(hex)
    await window.serial.write(payload, targetSessionId)
  }

  // 等待一条固定长度且满足条件的响应帧。
  async requestFrame(
    send: () => Promise<void> | void,
    matcher: (frame: PadParsedFrame) => boolean,
    timeout = 2000,
    sessionId = this.activeSessionId
  ) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)

    return await new Promise<PadParsedFrame>(async (resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      const cleanup = (dispose: () => void) => {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
        dispose()
      }

      const dispose = this.subscribeFrame((incomingSessionId, frame) => {
        if (incomingSessionId !== targetSessionId) {
          return
        }
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
    options: PadRawResponseOptions = {},
    sessionId = this.activeSessionId
  ) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
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

      const dispose = this.subscribeRawData((incomingSessionId, chunk) => {
        if (incomingSessionId !== targetSessionId) {
          return
        }

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

    window.serial.onOpen((_event: IpcRendererEvent, payload: SerialSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = true
      state.lastError = null
      this.emitStatus(sessionId)
    })

    window.serial.onClose((_event: IpcRendererEvent, payload: SerialSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = false
      this.resetRxBuffer(sessionId)
      this.emitStatus(sessionId)
    })

    window.serial.onError((_event: IpcRendererEvent, payload: SerialErrorEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = false
      state.lastError = payload.message
      this.resetRxBuffer(sessionId)
      this.emitStatus(sessionId)
    })

    window.serial.onData((_event: IpcRendererEvent, payload: SerialDataEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      this.handleIncomingData(sessionId, payload.data)
    })
  }

  // 向所有状态订阅者广播指定会话快照。
  private emitStatus(sessionId: number) {
    const snapshot = this.getSnapshot(sessionId)
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  // 处理指定会话新收到的原始串口数据：先转 HEX，再拆固定长度响应。
  private handleIncomingData(sessionId: number, data: string) {
    const normalized = normalizePadHex(data)
    if (!normalized) {
      return
    }

    this.rawDataListeners.forEach((listener) => {
      listener(sessionId, normalized)
    })

    const state = this.getSessionState(sessionId)
    state.fixedFrameBuffer += normalized

    const extracted = extractPadFixedLengthFrames(state.fixedFrameBuffer)
    state.fixedFrameBuffer = extracted.rest

    extracted.frames.forEach((frameHex) => {
      const frame = parsePadFrame(frameHex)
      if (!frame) {
        return
      }
      this.frameListeners.forEach((listener) => {
        listener(sessionId, frame)
      })
    })
  }

  // 清空指定会话固定长度响应半包缓冲。
  private resetRxBuffer(sessionId: number) {
    const state = this.getSessionState(sessionId)
    state.fixedFrameBuffer = ''
  }

  // 获取会话状态；不存在时自动初始化。
  private getSessionState(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    let state = this.sessionStates.get(targetSessionId)
    if (!state) {
      state = createSessionState()
      this.sessionStates.set(targetSessionId, state)
    }
    return state
  }

  // 仅获取已初始化会话状态；不存在时返回 null。
  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

// PAD 设备在项目层维护一个会话池单例。
export const padSingleDevice = new PadSingleDevice()

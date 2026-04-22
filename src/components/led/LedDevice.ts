// Electron 侧事件类型，仅用于标注事件回调入参。
import type { IpcRendererEvent } from 'electron'

// 只带会话 ID 的串口事件结构。
type SerialSessionEvent = {
  // 对应的会话 ID。
  sessionId: number
}

// 带错误消息的串口事件结构。
type SerialErrorEvent = SerialSessionEvent & {
  // 错误文案。
  message: string
}

// LED 设备快照。
export interface LedDeviceSnapshot {
  // 快照所属会话 ID。
  sessionId: number
  // 当前会话是否连接。
  connected: boolean
  // 当前串口路径。
  portPath: string
  // 当前波特率。
  baudRate: number
  // 最近一次错误信息。
  lastError: string | null
}

// LED 会话内部状态。
type LedSessionState = {
  // 当前会话是否已连接。
  connected: boolean
  // 当前串口路径。
  portPath: string
  // 当前波特率。
  baudRate: number
  // 最近一次错误文案。
  lastError: string | null
}

// 默认会话 ID。
const DEFAULT_LED_SESSION_ID = 0
// 默认波特率。
const DEFAULT_LED_BAUD_RATE = 9600

// 把任意输入规范成合法的非负整数会话 ID。
const normalizeSessionId = (sessionId?: number) => {
  const parsed = Number(sessionId)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_LED_SESSION_ID
  }
  return parsed
}

// 统一规范化 HEX。
function normalizeHex(input: string) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

// 要求输入必须是合法的偶数位 HEX。
function requireHexPayload(input: string, label = 'HEX') {
  const value = normalizeHex(input)
  if (!value) {
    throw new Error(`${label}不能为空`)
  }
  if (!/^[0-9A-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label}必须是偶数位 HEX`)
  }
  return value
}

// 构造默认会话状态。
const createSessionState = (): LedSessionState => ({
  connected: false,
  portPath: '',
  baudRate: DEFAULT_LED_BAUD_RATE,
  lastError: null
})

// LED 独立设备单例：负责会话状态和串口发送。
class LedDevice {
  // 避免重复绑定 Electron 事件。
  private initialized = false

  // 当前激活会话 ID。
  private activeSessionId = DEFAULT_LED_SESSION_ID

  // 会话状态池。
  private sessionStates = new Map<number, LedSessionState>()

  // 切换当前激活会话。
  setActiveSession(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.getSessionState(targetSessionId)
  }

  // 对外返回指定会话状态快照。
  getSnapshot(sessionId = this.activeSessionId): LedDeviceSnapshot {
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

  // 透传串口列表查询。
  async listPorts() {
    return window.serial.list()
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
  }

  // 按指定会话发送一条完整 HEX 指令。
  async sendHex(hex: string, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    const state = this.getSessionState(targetSessionId)

    if (!state.connected) {
      throw new Error(`LED 会话[${targetSessionId}]未连接`)
    }

    const payload = requireHexPayload(hex)
    await window.serial.write(payload, targetSessionId)
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
    })

    window.serial.onClose((_event: IpcRendererEvent, payload: SerialSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = false
    })

    window.serial.onError((_event: IpcRendererEvent, payload: SerialErrorEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = false
      state.lastError = payload.message
    })
  }

  // 获取会话状态，不存在就初始化。
  private getSessionState(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    const existing = this.sessionStates.get(targetSessionId)
    if (existing) {
      return existing
    }

    const state = createSessionState()
    this.sessionStates.set(targetSessionId, state)
    return state
  }

  // 仅读取已存在会话状态。
  private getSessionStateIfExists(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    return this.sessionStates.get(targetSessionId)
  }
}

// LED 设备单例。
export const ledSingleDevice = new LedDevice()

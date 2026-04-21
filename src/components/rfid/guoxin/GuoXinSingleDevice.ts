import { normalizeHex } from './GuoXinCommon'
import type { IpcRendererEvent } from 'electron'

type ConnectionSessionEvent = {
  sessionId: number
}

type ConnectionDataEvent = ConnectionSessionEvent & {
  data: string
}

type ConnectionErrorEvent = ConnectionSessionEvent & {
  message: string
}

// 国芯设备当前支持的两种连接方式。
export type GuoxinConnectionMode = 'serial' | 'tcp'

// 当前内部只暴露一类业务数据事件。
type GuoXinEventName = 'GuoXin_Data'

// 完整协议帧监听器，供上层业务解析使用。
type GuoXinDataListener = (data: string) => void

// 原始完整帧监听器，保留会话和数据来源，供日志或调试使用。
type GuoXinRawDataListener = (
  sessionId: number,
  source: GuoxinConnectionMode,
  data: string
) => void

// 设备状态监听器。
type GuoXinStatusListener = (state: GuoxinDeviceSnapshot) => void

export interface GuoxinDeviceSnapshot {
  // 当前实际使用的连接模式。
  mode: GuoxinConnectionMode
  // 当前连接会话 ID。
  sessionId: number
  // 当前通道是否已经连通。
  connected: boolean
  // 当前缓存的天线数量配置。
  antNum: number
  // 最近一次连接或通信错误。
  lastError: string | null
}

type GuoxinSessionState = {
  mode: GuoxinConnectionMode
  connected: boolean
  antNum: number
  lastError: string | null
  rxBuffers: Record<GuoxinConnectionMode, string>
}

const DEFAULT_GUOXIN_SESSION_ID = 0
const DEFAULT_GUOXIN_ANT_NUM = 4

const normalizeSessionId = (sessionId?: number) => {
  const parsed = Number(sessionId)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_GUOXIN_SESSION_ID
  }
  return parsed
}

const createSessionState = (): GuoxinSessionState => ({
  mode: 'tcp',
  connected: false,
  antNum: DEFAULT_GUOXIN_ANT_NUM,
  lastError: null,
  rxBuffers: {
    serial: '',
    tcp: ''
  }
})

class GuoXinSingleDevice {
  // 避免重复注册 IPC 监听器。
  private initialized = false

  // 当前激活会话 ID，供未显式传参的方法兜底使用。
  private activeSessionId = DEFAULT_GUOXIN_SESSION_ID

  // 会话状态池，每个 session 独立维护连接状态和接收缓冲。
  private sessionStates = new Map<number, GuoxinSessionState>()

  // 业务层完整帧监听器按会话隔离。
  private commandDataListeners = new Map<number, Set<GuoXinDataListener>>()

  // 原始完整帧监听器集合（全会话广播）。
  private rawDataListeners = new Set<GuoXinRawDataListener>()

  // 状态监听器集合（按会话状态变更广播）。
  private statusListeners = new Set<GuoXinStatusListener>()

  /**
   * 获取当前缓存的天线数量。
   */
  get antNum() {
    return this.getSessionState(this.activeSessionId).antNum
  }

  /**
   * 获取当前连接模式。
   */
  get currentMode() {
    return this.getSessionState(this.activeSessionId).mode
  }

  /**
   * 获取当前激活会话 ID。
   */
  get currentSessionId() {
    return this.activeSessionId
  }

  /**
   * 获取当前激活会话是否已连接。
   */
  get isConnected() {
    return this.getSessionState(this.activeSessionId).connected
  }

  /**
   * 切换当前激活会话。
   */
  setActiveSession(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.getSessionState(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  /**
   * 获取指定会话天线数量。
   */
  getAntNum(sessionId = this.activeSessionId) {
    return this.getSessionState(sessionId).antNum
  }

  /**
   * 更新设备侧缓存的天线数量。
   */
  setAntNum(antNum: number, sessionId = this.activeSessionId) {
    if (!Number.isInteger(antNum) || antNum <= 0) {
      throw new Error('天线数量必须是大于 0 的整数')
    }

    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionState(targetSessionId)

    if (state.antNum === antNum) {
      return
    }

    state.antNum = antNum
    this.emitStatus(targetSessionId)
  }

  /**
   * 生成指定会话的设备状态快照。
   */
  getSnapshot(sessionId = this.activeSessionId): GuoxinDeviceSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionState(targetSessionId)

    return {
      mode: state.mode,
      sessionId: targetSessionId,
      connected: state.connected,
      antNum: state.antNum,
      lastError: state.lastError
    }
  }

  /**
   * 返回当前所有已初始化会话快照。
   */
  getSnapshots() {
    if (!this.sessionStates.size) {
      return [this.getSnapshot(this.activeSessionId)]
    }

    return Array.from(this.sessionStates.keys())
      .sort((a, b) => a - b)
      .map((sessionId) => this.getSnapshot(sessionId))
  }

  /**
   * 订阅设备状态变化。
   */
  subscribeStatus(listener: GuoXinStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)
    listener(this.getSnapshot(this.activeSessionId))

    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /**
   * 订阅完整原始帧数据，通常用于日志和调试。
   */
  subscribeRawData(listener: GuoXinRawDataListener) {
    this.ensureInitialized()
    this.rawDataListeners.add(listener)

    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  /**
   * 切换指定会话的连接模式。
   */
  setMode(mode: GuoxinConnectionMode, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId

    const state = this.getSessionState(targetSessionId)
    state.mode = mode
    state.connected = false
    state.lastError = null
    this.resetRxBuffers(targetSessionId)

    this.emitStatus(targetSessionId)
  }

  /**
   * 连接串口设备。
   */
  async connectSerial(options: { sessionId?: number; path: string; baudRate: number }) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(options.sessionId)
    this.activeSessionId = targetSessionId

    const state = this.getSessionState(targetSessionId)

    if (state.connected && state.mode !== 'serial') {
      await this.disconnect(state.mode, targetSessionId)
    }

    state.mode = 'serial'
    state.lastError = null
    this.resetRxBuffer(targetSessionId, 'serial')
    this.emitStatus(targetSessionId)

    await window.serial.open({
      sessionId: targetSessionId,
      path: options.path,
      baudRate: options.baudRate
    })
  }

  /**
   * 连接 TCP 设备。
   */
  async connectTcp(options: { sessionId?: number; host: string; port: number }) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(options.sessionId)
    this.activeSessionId = targetSessionId

    const state = this.getSessionState(targetSessionId)

    if (state.connected && state.mode !== 'tcp') {
      await this.disconnect(state.mode, targetSessionId)
    }

    state.mode = 'tcp'
    state.lastError = null
    this.resetRxBuffer(targetSessionId, 'tcp')
    this.emitStatus(targetSessionId)

    await window.tcp.connect({
      sessionId: targetSessionId,
      host: options.host,
      port: options.port
    })
  }

  /**
   * 断开指定会话连接，默认断开该会话当前模式。
   */
  async disconnect(mode?: GuoxinConnectionMode, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId

    const state = this.getSessionState(targetSessionId)
    const targetMode = mode ?? state.mode

    if (targetMode === 'serial') {
      await window.serial.close(targetSessionId)
    } else {
      await window.tcp.disconnect(targetSessionId)
    }

    this.resetRxBuffer(targetSessionId, targetMode)

    if (state.mode === targetMode) {
      state.connected = false
      this.emitStatus(targetSessionId)
    }
  }

  /**
   * 按指定会话当前模式发送 HEX 指令。
   */
  sendMessageNew(hex: string, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId

    const state = this.getSessionState(targetSessionId)

    if (!state.connected) {
      throw new Error(`国芯 RFID 会话[${targetSessionId}]未连接`)
    }

    const payload = normalizeHex(hex)

    if (state.mode === 'serial') {
      void window.serial.write(payload, targetSessionId)
      return
    }

    void window.tcp.write(payload, targetSessionId)
  }

  /**
   * 注册业务层完整帧监听器（按会话隔离）。
   */
  on(eventName: GuoXinEventName, listener: GuoXinDataListener, sessionId = this.activeSessionId) {
    this.ensureInitialized()
    if (eventName !== 'GuoXin_Data') return

    const targetSessionId = normalizeSessionId(sessionId)
    const listeners = this.getCommandListeners(targetSessionId)
    listeners.add(listener)
  }

  /**
   * 取消注册业务层完整帧监听器（按会话隔离）。
   */
  off(
    eventName: GuoXinEventName,
    listener?: GuoXinDataListener,
    sessionId = this.activeSessionId
  ) {
    if (eventName !== 'GuoXin_Data') return

    const targetSessionId = normalizeSessionId(sessionId)
    const listeners = this.commandDataListeners.get(targetSessionId)
    if (!listeners) return

    if (listener) {
      listeners.delete(listener)
      if (!listeners.size) {
        this.commandDataListeners.delete(targetSessionId)
      }
      return
    }

    listeners.clear()
    this.commandDataListeners.delete(targetSessionId)
  }

  /**
   * 延迟注册底层 IPC 事件，确保只初始化一次。
   */
  private ensureInitialized() {
    if (this.initialized) return

    this.initialized = true

    window.serial.onOpen((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state || state.mode !== 'serial') return

      state.connected = true
      state.lastError = null
      this.emitStatus(sessionId)
    })

    window.serial.onClose((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state || state.mode !== 'serial') return

      state.connected = false
      this.resetRxBuffer(sessionId, 'serial')
      this.emitStatus(sessionId)
    })

    window.serial.onError((_event: IpcRendererEvent, payload: ConnectionErrorEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state || state.mode !== 'serial') return

      state.connected = false
      state.lastError = payload.message
      this.resetRxBuffer(sessionId, 'serial')
      this.emitStatus(sessionId)
    })

    window.serial.onData((_event: IpcRendererEvent, payload: ConnectionDataEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) return

      this.emitData('serial', sessionId, payload.data)
    })

    window.tcp.onConnect((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state || state.mode !== 'tcp') return

      state.connected = true
      state.lastError = null
      this.emitStatus(sessionId)
    })

    window.tcp.onClose((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state || state.mode !== 'tcp') return

      state.connected = false
      this.resetRxBuffer(sessionId, 'tcp')
      this.emitStatus(sessionId)
    })

    window.tcp.onError((_event: IpcRendererEvent, payload: ConnectionErrorEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state || state.mode !== 'tcp') return

      state.connected = false
      state.lastError = payload.message
      this.resetRxBuffer(sessionId, 'tcp')
      this.emitStatus(sessionId)
    })

    window.tcp.onData((_event: IpcRendererEvent, payload: ConnectionDataEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) return

      this.emitData('tcp', sessionId, payload.data)
    })
  }

  /**
   * 接收一段原始数据，拆成完整帧后再分发。
   */
  private emitData(source: GuoxinConnectionMode, sessionId: number, data: string) {
    const state = this.getSessionStateIfExists(sessionId)
    if (!state) return

    const frames = this.handleNewRx(sessionId, source, data)
    if (!frames.length) return

    frames.forEach((frame) => {
      this.rawDataListeners.forEach((listener) => {
        listener(sessionId, source, frame)
      })

      if (source !== state.mode) return

      const sessionListeners = this.commandDataListeners.get(sessionId)
      if (!sessionListeners?.size) return

      sessionListeners.forEach((listener) => {
        listener(frame)
      })
    })
  }

  /**
   * 向所有状态订阅方广播指定会话当前状态。
   */
  private emitStatus(sessionId: number) {
    const snapshot = this.getSnapshot(sessionId)
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  /**
   * 处理新收到的原始 HEX 数据，完成半包拼接和粘包拆分。
   */
  private handleNewRx(sessionId: number, source: GuoxinConnectionMode, data: string): string[] {
    const normalized = normalizeHex(String(data ?? ''))
    if (!normalized) {
      return []
    }

    const state = this.getSessionState(sessionId)
    let buffer = (state.rxBuffers[source] || '') + normalized

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

    state.rxBuffers[source] = buffer
    return frames
  }

  /**
   * 清空指定会话和指定通道的接收缓冲。
   */
  private resetRxBuffer(sessionId: number, mode: GuoxinConnectionMode) {
    const state = this.getSessionState(sessionId)
    state.rxBuffers[mode] = ''
  }

  /**
   * 清空指定会话全部通道接收缓冲。
   */
  private resetRxBuffers(sessionId: number) {
    this.resetRxBuffer(sessionId, 'serial')
    this.resetRxBuffer(sessionId, 'tcp')
  }

  /**
   * 获取会话对应的业务监听集合。
   */
  private getCommandListeners(sessionId: number) {
    let listeners = this.commandDataListeners.get(sessionId)
    if (!listeners) {
      listeners = new Set<GuoXinDataListener>()
      this.commandDataListeners.set(sessionId, listeners)
    }
    return listeners
  }

  /**
   * 获取会话状态；不存在时自动初始化。
   */
  private getSessionState(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    let state = this.sessionStates.get(targetSessionId)
    if (!state) {
      state = createSessionState()
      this.sessionStates.set(targetSessionId, state)
    }
    return state
  }

  /**
   * 仅获取已初始化会话状态；不存在时返回 null。
   */
  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

// 导出单例，整个项目共用同一份设备会话池和事件通道。
export const guoxinSingleDevice = new GuoXinSingleDevice()

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

export type GuoxinConnectionMode = 'serial' | 'tcp'

type GuoXinEventName = 'GuoXin_Data'

type GuoXinDataListener = (data: string) => void

type GuoXinRawDataListener = (
  sessionId: number,
  source: GuoxinConnectionMode,
  data: string
) => void

type GuoXinStatusListener = (state: GuoxinDeviceSnapshot) => void

export interface GuoxinDeviceSnapshot {
  mode: GuoxinConnectionMode
  sessionId: number
  connected: boolean
  antNum: number
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
const FRAME_HEAD = '5A'
const FRAME_MIN_HEAD_CHARS = 14
const FRAME_FIXED_CHARS = 18

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
  private initialized = false
  private activeSessionId = DEFAULT_GUOXIN_SESSION_ID

  private sessionStates = new Map<number, GuoxinSessionState>()
  private commandDataListeners = new Map<number, Set<GuoXinDataListener>>()
  private rawDataListeners = new Set<GuoXinRawDataListener>()
  private statusListeners = new Set<GuoXinStatusListener>()

  get antNum() {
    return this.getSessionState(this.activeSessionId).antNum
  }

  get currentMode() {
    return this.getSessionState(this.activeSessionId).mode
  }

  get currentSessionId() {
    return this.activeSessionId
  }

  get isConnected() {
    return this.getSessionState(this.activeSessionId).connected
  }

  setActiveSession(sessionId: number) {
    const targetSessionId = this.activateSession(sessionId)
    this.getSessionState(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  getAntNum(sessionId = this.activeSessionId) {
    return this.getSessionState(sessionId).antNum
  }

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

  getSnapshots() {
    if (!this.sessionStates.size) {
      return [this.getSnapshot(this.activeSessionId)]
    }

    return Array.from(this.sessionStates.keys())
      .sort((a, b) => a - b)
      .map((sessionId) => this.getSnapshot(sessionId))
  }

  subscribeStatus(listener: GuoXinStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)
    listener(this.getSnapshot(this.activeSessionId))

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

  setMode(mode: GuoxinConnectionMode, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = this.activateSession(sessionId)
    const state = this.getSessionState(targetSessionId)

    state.mode = mode
    state.connected = false
    state.lastError = null
    this.resetRxBuffers(targetSessionId)

    this.emitStatus(targetSessionId)
  }

  async connectSerial(options: { sessionId?: number; path: string; baudRate: number }) {
    await this.connectByMode('serial', options.sessionId, (sessionId) => {
      return window.serial.open({
        sessionId,
        path: options.path,
        baudRate: options.baudRate
      })
    })
  }

  async connectTcp(options: { sessionId?: number; host: string; port: number }) {
    await this.connectByMode('tcp', options.sessionId, (sessionId) => {
      return window.tcp.connect({
        sessionId,
        host: options.host,
        port: options.port
      })
    })
  }

  async disconnect(mode?: GuoxinConnectionMode, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = this.activateSession(sessionId)
    const state = this.getSessionState(targetSessionId)
    const targetMode = mode ?? state.mode

    if (targetMode === 'serial') {
      await window.serial.close(targetSessionId)
    } else {
      await window.tcp.disconnect(targetSessionId)
    }

    this.resetRxBuffer(targetSessionId, targetMode)

    if (state.mode !== targetMode) {
      return
    }

    state.connected = false
    this.emitStatus(targetSessionId)
  }

  sendMessageNew(hex: string, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = this.activateSession(sessionId)
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

  on(eventName: GuoXinEventName, listener: GuoXinDataListener, sessionId = this.activeSessionId) {
    this.ensureInitialized()
    if (eventName !== 'GuoXin_Data') {
      return
    }

    const targetSessionId = normalizeSessionId(sessionId)
    this.getCommandListeners(targetSessionId).add(listener)
  }

  off(
    eventName: GuoXinEventName,
    listener?: GuoXinDataListener,
    sessionId = this.activeSessionId
  ) {
    if (eventName !== 'GuoXin_Data') {
      return
    }

    const targetSessionId = normalizeSessionId(sessionId)
    const listeners = this.commandDataListeners.get(targetSessionId)
    if (!listeners) {
      return
    }

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

  private activateSession(sessionId?: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    return targetSessionId
  }

  private async connectByMode(
    mode: GuoxinConnectionMode,
    sessionId: number | undefined,
    connectAction: (sessionId: number) => Promise<boolean | void>
  ) {
    this.ensureInitialized()

    const targetSessionId = this.activateSession(sessionId)
    const state = this.getSessionState(targetSessionId)

    if (state.connected && state.mode !== mode) {
      await this.disconnect(state.mode, targetSessionId)
    }

    state.mode = mode
    state.lastError = null
    this.resetRxBuffer(targetSessionId, mode)
    this.emitStatus(targetSessionId)

    await connectAction(targetSessionId)
  }

  private ensureInitialized() {
    if (this.initialized) {
      return
    }

    this.initialized = true
    this.bindSerialEvents()
    this.bindTcpEvents()
  }

  private bindSerialEvents() {
    window.serial.onOpen((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      this.handleConnected('serial', payload.sessionId)
    })

    window.serial.onClose((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      this.handleDisconnected('serial', payload.sessionId)
    })

    window.serial.onError((_event: IpcRendererEvent, payload: ConnectionErrorEvent) => {
      this.handleError('serial', payload)
    })

    window.serial.onData((_event: IpcRendererEvent, payload: ConnectionDataEvent) => {
      this.handleIncomingData('serial', payload)
    })
  }

  private bindTcpEvents() {
    window.tcp.onConnect((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      this.handleConnected('tcp', payload.sessionId)
    })

    window.tcp.onClose((_event: IpcRendererEvent, payload: ConnectionSessionEvent) => {
      this.handleDisconnected('tcp', payload.sessionId)
    })

    window.tcp.onError((_event: IpcRendererEvent, payload: ConnectionErrorEvent) => {
      this.handleError('tcp', payload)
    })

    window.tcp.onData((_event: IpcRendererEvent, payload: ConnectionDataEvent) => {
      this.handleIncomingData('tcp', payload)
    })
  }

  private handleConnected(mode: GuoxinConnectionMode, rawSessionId: number) {
    const sessionId = normalizeSessionId(rawSessionId)
    const state = this.getSessionStateIfExists(sessionId)
    if (!state || state.mode !== mode) {
      return
    }

    state.connected = true
    state.lastError = null
    this.emitStatus(sessionId)
  }

  private handleDisconnected(mode: GuoxinConnectionMode, rawSessionId: number) {
    const sessionId = normalizeSessionId(rawSessionId)
    const state = this.getSessionStateIfExists(sessionId)
    if (!state || state.mode !== mode) {
      return
    }

    state.connected = false
    this.resetRxBuffer(sessionId, mode)
    this.emitStatus(sessionId)
  }

  private handleError(mode: GuoxinConnectionMode, payload: ConnectionErrorEvent) {
    const sessionId = normalizeSessionId(payload.sessionId)
    const state = this.getSessionStateIfExists(sessionId)
    if (!state || state.mode !== mode) {
      return
    }

    state.connected = false
    state.lastError = payload.message
    this.resetRxBuffer(sessionId, mode)
    this.emitStatus(sessionId)
  }

  private handleIncomingData(mode: GuoxinConnectionMode, payload: ConnectionDataEvent) {
    const sessionId = normalizeSessionId(payload.sessionId)
    if (!this.getSessionStateIfExists(sessionId)) {
      return
    }

    this.emitData(mode, sessionId, payload.data)
  }

  private emitData(source: GuoxinConnectionMode, sessionId: number, data: string) {
    const state = this.getSessionStateIfExists(sessionId)
    if (!state) {
      return
    }

    const frames = this.handleNewRx(sessionId, source, data)
    if (!frames.length) {
      return
    }

    const sessionListeners = this.commandDataListeners.get(sessionId)

    for (const frame of frames) {
      this.emitRawFrame(sessionId, source, frame)

      if (source !== state.mode || !sessionListeners?.size) {
        continue
      }

      for (const listener of sessionListeners) {
        listener(frame)
      }
    }
  }

  private emitRawFrame(sessionId: number, source: GuoxinConnectionMode, frame: string) {
    for (const listener of this.rawDataListeners) {
      listener(sessionId, source, frame)
    }
  }

  private emitStatus(sessionId: number) {
    const snapshot = this.getSnapshot(sessionId)
    for (const listener of this.statusListeners) {
      listener(snapshot)
    }
  }

  private handleNewRx(sessionId: number, source: GuoxinConnectionMode, data: string): string[] {
    const normalized = normalizeHex(String(data ?? ''))
    if (!normalized) {
      return []
    }

    const state = this.getSessionState(sessionId)
    let buffer = (state.rxBuffers[source] || '') + normalized
    const frames: string[] = []

    while (true) {
      const frameHeadIndex = buffer.indexOf(FRAME_HEAD)
      if (frameHeadIndex === -1) {
        buffer = ''
        break
      }

      if (frameHeadIndex > 0) {
        buffer = buffer.slice(frameHeadIndex)
      }

      if (buffer.length < FRAME_MIN_HEAD_CHARS) {
        break
      }

      const payloadLength = parseInt(buffer.slice(10, 14), 16)
      if (Number.isNaN(payloadLength)) {
        buffer = buffer.slice(2)
        continue
      }

      const frameLength = FRAME_FIXED_CHARS + payloadLength * 2
      if (buffer.length < frameLength) {
        break
      }

      frames.push(buffer.slice(0, frameLength))
      buffer = buffer.slice(frameLength)
    }

    state.rxBuffers[source] = buffer
    return frames
  }

  private resetRxBuffer(sessionId: number, mode: GuoxinConnectionMode) {
    this.getSessionState(sessionId).rxBuffers[mode] = ''
  }

  private resetRxBuffers(sessionId: number) {
    this.resetRxBuffer(sessionId, 'serial')
    this.resetRxBuffer(sessionId, 'tcp')
  }

  private getCommandListeners(sessionId: number) {
    let listeners = this.commandDataListeners.get(sessionId)
    if (!listeners) {
      listeners = new Set<GuoXinDataListener>()
      this.commandDataListeners.set(sessionId, listeners)
    }
    return listeners
  }

  private getSessionState(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    let state = this.sessionStates.get(targetSessionId)
    if (!state) {
      state = createSessionState()
      this.sessionStates.set(targetSessionId, state)
    }
    return state
  }

  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

export const guoxinSingleDevice = new GuoXinSingleDevice()

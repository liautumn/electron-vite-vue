import { normalizeHex } from './GuoXinCommon'
import {
  transportSessionHub,
  type TransportConnectionMode
} from '../../transport/TransportSessionHub'

export type GuoxinConnectionMode = TransportConnectionMode

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
  antNum: number
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

const createSessionState = (mode: GuoxinConnectionMode): GuoxinSessionState => ({
  mode,
  antNum: DEFAULT_GUOXIN_ANT_NUM,
  rxBuffers: {
    serial: '',
    tcp: ''
  }
})

class GuoXinDevice {
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
    return this.getSnapshot(this.activeSessionId).connected
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
    const runtime = transportSessionHub.getSnapshot(targetSessionId)

    return {
      mode: runtime.mode,
      sessionId: targetSessionId,
      connected: runtime.connected,
      antNum: state.antNum,
      lastError: runtime.lastError
    }
  }

  getSnapshots() {
    const sessionIds = new Set<number>(this.sessionStates.keys())
    sessionIds.add(this.activeSessionId)

    return [...sessionIds]
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

  sendMessageNew(hex: string, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = this.activateSession(sessionId)
    const snapshot = this.getSnapshot(targetSessionId)

    if (!snapshot.connected) {
      throw new Error(`国芯 RFID 会话[${targetSessionId}]未连接`)
    }

    const payload = normalizeHex(hex)
    void transportSessionHub.sendHex(payload, targetSessionId)
  }

  on(listener: GuoXinDataListener, sessionId = this.activeSessionId) {
    this.ensureInitialized()
    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
    this.getCommandListeners(targetSessionId).add(listener)
  }

  off(listener?: GuoXinDataListener, sessionId = this.activeSessionId) {
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

  private ensureInitialized() {
    if (this.initialized) {
      return
    }

    this.initialized = true

    transportSessionHub.subscribeStatus((snapshot) => {
      const sessionId = normalizeSessionId(snapshot.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      if (state.mode !== snapshot.mode) {
        state.mode = snapshot.mode
        this.resetRxBuffersByState(state)
      }

      this.emitStatus(sessionId)
    })

    transportSessionHub.subscribeData((sessionId, source, data) => {
      if (!this.getSessionStateIfExists(sessionId)) {
        return
      }

      this.emitData(source, sessionId, data)
    })
  }

  private emitData(source: GuoxinConnectionMode, sessionId: number, data: string) {
    const state = this.getSessionStateIfExists(sessionId)
    if (!state) {
      return
    }

    const runtime = transportSessionHub.getSnapshot(sessionId)
    if (state.mode !== runtime.mode) {
      state.mode = runtime.mode
      this.resetRxBuffersByState(state)
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

  private resetRxBuffersByState(state: GuoxinSessionState) {
    state.rxBuffers.serial = ''
    state.rxBuffers.tcp = ''
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
    const runtime = transportSessionHub.getSnapshot(targetSessionId)
    let state = this.sessionStates.get(targetSessionId)

    if (!state) {
      state = createSessionState(runtime.mode)
      this.sessionStates.set(targetSessionId, state)
      return state
    }

    if (state.mode !== runtime.mode) {
      state.mode = runtime.mode
      this.resetRxBuffersByState(state)
    }

    return state
  }

  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

export const guoxinSingleDevice = new GuoXinDevice()

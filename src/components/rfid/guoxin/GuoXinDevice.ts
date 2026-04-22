import { normalizeHex } from './GuoXinCommon'
import type { TransportConnectionMode } from '../../../types/connection'

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
  connected: boolean
  lastError: string | null
  rxBuffers: Record<GuoxinConnectionMode, string>
}

const DEFAULT_GUOXIN_SESSION_ID = 0
const DEFAULT_GUOXIN_ANT_NUM = 4
const DEFAULT_MODE: GuoxinConnectionMode = 'tcp'
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
  connected: false,
  lastError: null,
  rxBuffers: {
    serial: '',
    tcp: ''
  }
})

class GuoXinDevice {
  private activeSessionId = DEFAULT_GUOXIN_SESSION_ID

  private sessionStates = new Map<number, GuoxinSessionState>()
  private sessionDisposers = new Map<number, Array<() => void>>()

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
    this.ensureSessionWired(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  setMode(mode: GuoxinConnectionMode, sessionId = this.activeSessionId) {
    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionState(targetSessionId)

    if (state.mode === mode) {
      return
    }

    state.mode = mode
    this.resetRxBuffersByState(state)
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
    const sessionIds = new Set<number>(this.sessionStates.keys())
    sessionIds.add(this.activeSessionId)

    return [...sessionIds]
      .sort((a, b) => a - b)
      .map((sessionId) => this.getSnapshot(sessionId))
  }

  subscribeStatus(listener: GuoXinStatusListener) {
    this.statusListeners.add(listener)
    listener(this.getSnapshot(this.activeSessionId))

    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeRawData(listener: GuoXinRawDataListener) {
    this.rawDataListeners.add(listener)

    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  sendMessageNew(hex: string, sessionId = this.activeSessionId) {
    const targetSessionId = this.activateSession(sessionId)
    this.getSessionState(targetSessionId)
    this.ensureSessionWired(targetSessionId)

    const payload = normalizeHex(hex)
    if (!payload) {
      throw new Error('HEX 不能为空')
    }
    if (!/^[0-9A-F]+$/.test(payload) || payload.length % 2 !== 0) {
      throw new Error('HEX 必须是偶数位十六进制字符')
    }

    void this.writeHex(targetSessionId, payload).catch((error) => {
      const state = this.getSessionState(targetSessionId)
      state.connected = false
      state.lastError = error instanceof Error ? error.message : String(error)
      this.emitStatus(targetSessionId)
    })
  }

  on(listener: GuoXinDataListener, sessionId = this.activeSessionId) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
    this.ensureSessionWired(targetSessionId)
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

  private ensureSessionWired(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    if (this.sessionDisposers.has(targetSessionId)) {
      return
    }

    const disposers: Array<() => void> = []
    const tcpSession = window.tcp.getSessionById(targetSessionId)
    const serialSession = window.serial.getSessionById(targetSessionId)

    disposers.push(
      tcpSession.onConnect(() => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'tcp') {
          return
        }
        state.connected = true
        state.lastError = null
        this.emitStatus(targetSessionId)
      }),
      tcpSession.onClose(() => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'tcp') return
        state.connected = false
        this.emitStatus(targetSessionId)
      })
    )

    disposers.push(
      tcpSession.onError((payload: { message: string }) => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'tcp') {
          return
        }
        state.connected = false
        state.lastError = payload.message
        this.emitStatus(targetSessionId)
      }),
      tcpSession.onData((payload: { data: string }) => {
        this.emitData('tcp', targetSessionId, payload.data)
      })
    )

    disposers.push(
      serialSession.onOpen(() => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'serial') {
          return
        }
        state.connected = true
        state.lastError = null
        this.emitStatus(targetSessionId)
      }),
      serialSession.onClose(() => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'serial') return
        state.connected = false
        this.emitStatus(targetSessionId)
      })
    )

    disposers.push(
      serialSession.onError((payload: { message: string }) => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'serial') {
          return
        }
        state.connected = false
        state.lastError = payload.message
        this.emitStatus(targetSessionId)
      }),
      serialSession.onData((payload: { data: string }) => {
        this.emitData('serial', targetSessionId, payload.data)
      })
    )

    this.sessionDisposers.set(targetSessionId, disposers)
  }

  private async writeHex(sessionId: number, hex: string) {
    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionState(targetSessionId)

    const session =
      state.mode === 'serial'
        ? window.serial.getSessionById(targetSessionId)
        : window.tcp.getSessionById(targetSessionId)

    const ok = await session.write(hex)
    if (ok) {
      if (!state.connected || state.lastError) {
        state.connected = true
        state.lastError = null
        this.emitStatus(targetSessionId)
      }
      return
    }

    state.connected = false
    this.emitStatus(targetSessionId)
  }

  private emitData(source: GuoxinConnectionMode, sessionId: number, data: string) {
    const state = this.getSessionStateIfExists(sessionId)
    if (!state) {
      return
    }

    if (state.mode !== source) {
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

    let state = this.sessionStates.get(targetSessionId)
    if (!state) {
      state = createSessionState(DEFAULT_MODE)
      this.sessionStates.set(targetSessionId, state)
      return state
    }

    return state
  }

  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

export const guoxinDevice = new GuoXinDevice()

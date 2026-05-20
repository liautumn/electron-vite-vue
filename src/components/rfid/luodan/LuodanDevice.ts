import {
  normalizeHex,
  splitLuodanFrames
} from './LuodanCommon'
import type { TransportConnectionMode } from '../../../types/connection'

export type LuodanConnectionMode = TransportConnectionMode

type LuodanDataListener = (data: string) => void

type LuodanRawDataListener = (
  sessionId: number,
  source: LuodanConnectionMode,
  data: string
) => void

type LuodanStatusListener = (state: LuodanDeviceSnapshot) => void

export interface LuodanDeviceSnapshot {
  mode: LuodanConnectionMode
  sessionId: number
  connected: boolean
  lastError: string | null
}

type LuodanSessionState = {
  mode: LuodanConnectionMode
  connected: boolean
  lastError: string | null
  rxBuffers: Record<LuodanConnectionMode, string>
}

const DEFAULT_SESSION_ID = 0
const DEFAULT_MODE: LuodanConnectionMode = 'tcp'

const normalizeSessionId = (sessionId?: number) => {
  const parsed = Number(sessionId)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_SESSION_ID
  }
  return parsed
}

const createSessionState = (mode: LuodanConnectionMode): LuodanSessionState => ({
  mode,
  connected: false,
  lastError: null,
  rxBuffers: {
    serial: '',
    tcp: ''
  }
})

class LuodanDevice {
  private activeSessionId = DEFAULT_SESSION_ID

  private sessionStates = new Map<number, LuodanSessionState>()
  private sessionDisposers = new Map<number, Array<() => void>>()

  private commandDataListeners = new Map<number, Set<LuodanDataListener>>()
  private rawDataListeners = new Set<LuodanRawDataListener>()
  private statusListeners = new Set<LuodanStatusListener>()

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

  setMode(mode: LuodanConnectionMode, sessionId = this.activeSessionId) {
    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionState(targetSessionId)

    if (state.mode === mode) {
      return
    }

    state.mode = mode
    this.resetRxBuffersByState(state)
    this.emitStatus(targetSessionId)
  }

  getSnapshot(sessionId = this.activeSessionId): LuodanDeviceSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionState(targetSessionId)

    return {
      mode: state.mode,
      sessionId: targetSessionId,
      connected: state.connected,
      lastError: state.lastError
    }
  }

  subscribeStatus(listener: LuodanStatusListener) {
    this.statusListeners.add(listener)
    listener(this.getSnapshot(this.activeSessionId))

    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeRawData(listener: LuodanRawDataListener) {
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

  on(listener: LuodanDataListener, sessionId = this.activeSessionId) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
    this.ensureSessionWired(targetSessionId)
    this.getCommandListeners(targetSessionId).add(listener)
  }

  off(listener?: LuodanDataListener, sessionId = this.activeSessionId) {
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
        if (state.mode !== 'tcp') return
        state.connected = true
        state.lastError = null
        this.emitStatus(targetSessionId)
      }),
      tcpSession.onClose(() => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'tcp') return
        state.connected = false
        this.emitStatus(targetSessionId)
      }),
      tcpSession.onError((payload: { message: string }) => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'tcp') return
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
        if (state.mode !== 'serial') return
        state.connected = true
        state.lastError = null
        this.emitStatus(targetSessionId)
      }),
      serialSession.onClose(() => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'serial') return
        state.connected = false
        this.emitStatus(targetSessionId)
      }),
      serialSession.onError((payload: { message: string }) => {
        const state = this.getSessionState(targetSessionId)
        if (state.mode !== 'serial') return
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

  private emitData(source: LuodanConnectionMode, sessionId: number, data: string) {
    const state = this.getSessionStateIfExists(sessionId)
    if (!state || state.mode !== source) {
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

  private emitRawFrame(sessionId: number, source: LuodanConnectionMode, frame: string) {
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

  private handleNewRx(sessionId: number, source: LuodanConnectionMode, data: string): string[] {
    const state = this.getSessionState(sessionId)
    const { frames, buffer } = splitLuodanFrames(state.rxBuffers[source], data)
    state.rxBuffers[source] = buffer
    return frames
  }

  private resetRxBuffersByState(state: LuodanSessionState) {
    state.rxBuffers.serial = ''
    state.rxBuffers.tcp = ''
  }

  private getCommandListeners(sessionId: number) {
    let listeners = this.commandDataListeners.get(sessionId)
    if (!listeners) {
      listeners = new Set<LuodanDataListener>()
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

export const luodanDevice = new LuodanDevice()

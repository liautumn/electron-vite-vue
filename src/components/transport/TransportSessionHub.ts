export type TransportConnectionMode = 'serial' | 'tcp'

export type BaseTransportConnectionProfile = {
  id: string
  name: string
  sessionId: number
}

export type SerialTransportConnectionProfile = BaseTransportConnectionProfile & {
  mode: 'serial'
  portPath: string
  baudRate: number
}

export type TcpTransportConnectionProfile = BaseTransportConnectionProfile & {
  mode: 'tcp'
  host: string
  port: number
}

export type TransportConnectionProfile =
  | SerialTransportConnectionProfile
  | TcpTransportConnectionProfile

export interface TransportSessionSnapshot {
  sessionId: number
  mode: TransportConnectionMode
  connected: boolean
  lastError: string | null
  endpoint: string
}

type TransportStatusListener = (snapshot: TransportSessionSnapshot) => void
type TransportDataListener = (
  sessionId: number,
  mode: TransportConnectionMode,
  data: string
) => void

type TransportSessionState = {
  mode: TransportConnectionMode
  connected: boolean
  lastError: string | null
  endpoint: string
}

type SessionEvent = {
  sessionId: number
}

type ErrorEvent = SessionEvent & {
  message: string
}

type DataEvent = SessionEvent & {
  data: string
}

const DEFAULT_SESSION_ID = 0
const DEFAULT_SNAPSHOT_MODE: TransportConnectionMode = 'tcp'

const normalizeHex = (input: string) =>
  String(input ?? '').replace(/\s+/g, '').toUpperCase()

const normalizeSessionId = (sessionId?: number) => {
  const parsed = Number(sessionId)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_SESSION_ID
  }
  return parsed
}

const createDefaultState = (): TransportSessionState => ({
  mode: DEFAULT_SNAPSHOT_MODE,
  connected: false,
  lastError: null,
  endpoint: ''
})

const resolveEndpoint = (profile: TransportConnectionProfile) =>
  profile.mode === 'serial'
    ? `${profile.portPath || '未选择串口'} / ${profile.baudRate || 9600}`
    : `${profile.host || '-'}:${profile.port || '-'}`

class TransportSessionHub {
  private initialized = false
  private sessionStates = new Map<number, TransportSessionState>()
  private statusListeners = new Set<TransportStatusListener>()
  private dataListeners = new Set<TransportDataListener>()

  applyProfiles(profiles: TransportConnectionProfile[]) {
    profiles.forEach((profile) => {
      this.configure(profile)
    })
  }

  configure(profile: TransportConnectionProfile) {
    const sessionId = normalizeSessionId(profile.sessionId)
    const state = this.getSessionState(sessionId)
    const nextEndpoint = resolveEndpoint(profile)

    if (state.mode !== profile.mode) {
      state.mode = profile.mode
      state.connected = false
      state.lastError = null
    }

    state.endpoint = nextEndpoint
    this.emitStatus(sessionId)
  }

  async connect(profile: TransportConnectionProfile) {
    this.ensureInitialized()

    const sessionId = normalizeSessionId(profile.sessionId)
    this.configure(profile)

    if (profile.mode === 'serial') {
      if (!profile.portPath) {
        throw new Error('请先选择串口')
      }

      await window.serial.open({
        sessionId,
        path: profile.portPath,
        baudRate: Number(profile.baudRate) || 9600
      })
      return
    }

    if (!profile.host || !profile.port) {
      throw new Error('请填写 TCP 地址与端口')
    }

    await window.tcp.connect({
      sessionId,
      host: profile.host,
      port: Number(profile.port)
    })
  }

  async disconnect(sessionId?: number) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionStateIfExists(targetSessionId)

    if (!state) {
      throw new Error(`会话[${targetSessionId}]尚未配置`)
    }

    if (state.mode === 'serial') {
      await window.serial.close(targetSessionId)
      return
    }

    await window.tcp.disconnect(targetSessionId)
  }

  async sendHex(hex: string, sessionId?: number) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionStateIfExists(targetSessionId)

    if (!state) {
      throw new Error(`会话[${targetSessionId}]尚未配置`)
    }

    if (!state.connected) {
      throw new Error(`会话[${targetSessionId}]未连接`)
    }

    const payload = normalizeHex(hex)
    if (!payload) {
      throw new Error('HEX 不能为空')
    }

    const result =
      state.mode === 'serial'
        ? await window.serial.write(payload, targetSessionId)
        : await window.tcp.write(payload, targetSessionId)

    if (!result) {
      throw new Error(`会话[${targetSessionId}]发送失败`)
    }
  }

  getSnapshot(sessionId?: number): TransportSessionSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    const state = this.getSessionStateIfExists(targetSessionId) ?? createDefaultState()

    return {
      sessionId: targetSessionId,
      mode: state.mode,
      connected: state.connected,
      lastError: state.lastError,
      endpoint: state.endpoint
    }
  }

  getSnapshots() {
    if (!this.sessionStates.size) {
      return [this.getSnapshot(DEFAULT_SESSION_ID)]
    }

    return Array.from(this.sessionStates.keys())
      .sort((a, b) => a - b)
      .map((sessionId) => this.getSnapshot(sessionId))
  }

  subscribeStatus(listener: TransportStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)

    this.getSnapshots().forEach((snapshot) => {
      listener(snapshot)
    })

    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeData(listener: TransportDataListener) {
    this.ensureInitialized()
    this.dataListeners.add(listener)

    return () => {
      this.dataListeners.delete(listener)
    }
  }

  listSerialPorts() {
    return window.serial.list()
  }

  private ensureInitialized() {
    if (this.initialized) {
      return
    }

    this.initialized = true

    window.serial.onOpen((_event: unknown, payload: SessionEvent) => {
      this.handleConnected('serial', payload.sessionId)
    })

    window.serial.onClose((_event: unknown, payload: SessionEvent) => {
      this.handleDisconnected('serial', payload.sessionId)
    })

    window.serial.onError((_event: unknown, payload: ErrorEvent) => {
      this.handleError('serial', payload.sessionId, payload.message)
    })

    window.serial.onData((_event: unknown, payload: DataEvent) => {
      this.handleIncomingData('serial', payload.sessionId, payload.data)
    })

    window.tcp.onConnect((_event: unknown, payload: SessionEvent) => {
      this.handleConnected('tcp', payload.sessionId)
    })

    window.tcp.onClose((_event: unknown, payload: SessionEvent) => {
      this.handleDisconnected('tcp', payload.sessionId)
    })

    window.tcp.onError((_event: unknown, payload: ErrorEvent) => {
      this.handleError('tcp', payload.sessionId, payload.message)
    })

    window.tcp.onData((_event: unknown, payload: DataEvent) => {
      this.handleIncomingData('tcp', payload.sessionId, payload.data)
    })
  }

  private handleConnected(mode: TransportConnectionMode, rawSessionId: number) {
    const sessionId = normalizeSessionId(rawSessionId)
    const state = this.getSessionState(sessionId)

    if (state.mode !== mode) {
      return
    }

    state.connected = true
    state.lastError = null
    this.emitStatus(sessionId)
  }

  private handleDisconnected(mode: TransportConnectionMode, rawSessionId: number) {
    const sessionId = normalizeSessionId(rawSessionId)
    const state = this.getSessionStateIfExists(sessionId)

    if (!state || state.mode !== mode) {
      return
    }

    state.connected = false
    this.emitStatus(sessionId)
  }

  private handleError(mode: TransportConnectionMode, rawSessionId: number, message: string) {
    const sessionId = normalizeSessionId(rawSessionId)
    const state = this.getSessionStateIfExists(sessionId)

    if (!state || state.mode !== mode) {
      return
    }

    state.connected = false
    state.lastError = String(message ?? '')
    this.emitStatus(sessionId)
  }

  private handleIncomingData(mode: TransportConnectionMode, rawSessionId: number, rawData: string) {
    const sessionId = normalizeSessionId(rawSessionId)
    const state = this.getSessionStateIfExists(sessionId)

    if (!state || state.mode !== mode) {
      return
    }

    const data = normalizeHex(String(rawData ?? ''))
    if (!data) {
      return
    }

    this.dataListeners.forEach((listener) => {
      listener(sessionId, mode, data)
    })
  }

  private emitStatus(sessionId: number) {
    const snapshot = this.getSnapshot(sessionId)
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  private getSessionState(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    let state = this.sessionStates.get(targetSessionId)

    if (!state) {
      state = createDefaultState()
      this.sessionStates.set(targetSessionId, state)
    }

    return state
  }

  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

export const transportSessionHub = new TransportSessionHub()

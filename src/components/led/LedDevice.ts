import type { TransportConnectionMode } from '../../types/connection'

export interface LedDeviceSnapshot {
  sessionId: number
  mode: TransportConnectionMode
  connected: boolean
  lastError: string | null
}

type LedSessionRuntime = {
  mode: TransportConnectionMode
  connected: boolean
  lastError: string | null
}

const DEFAULT_LED_SESSION_ID = 0

const normalizeSessionId = (sessionId?: number) => {
  const parsed = Number(sessionId)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_LED_SESSION_ID
  }
  return parsed
}

function normalizeHex(input: string) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

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

class LedDevice {
  private activeSessionId = DEFAULT_LED_SESSION_ID
  private sessionRuntime = new Map<number, LedSessionRuntime>()
  private sessionDisposers = new Map<number, Array<() => void>>()

  setActiveSession(sessionId: number) {
    this.activeSessionId = normalizeSessionId(sessionId)
  }

  getSnapshot(sessionId = this.activeSessionId): LedDeviceSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    this.ensureSessionWired(targetSessionId)
    const runtime = this.getRuntimeState(targetSessionId)

    return {
      sessionId: targetSessionId,
      mode: runtime.mode,
      connected: runtime.connected,
      lastError: runtime.lastError
    }
  }

  async sendHex(hex: string, sessionId = this.activeSessionId) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.ensureSessionWired(targetSessionId)

    const payload = requireHexPayload(hex)
    const runtime = this.getRuntimeState(targetSessionId)

    const primarySession =
      runtime.mode === 'serial'
        ? window.serial.getSessionById(targetSessionId)
        : window.tcp.getSessionById(targetSessionId)

    const primaryOk = await primarySession.write(payload)
    if (primaryOk) {
      if (!runtime.connected || runtime.lastError) {
        runtime.connected = true
        runtime.lastError = null
      }
      return
    }

    const fallbackSession =
      runtime.mode === 'serial'
        ? window.tcp.getSessionById(targetSessionId)
        : window.serial.getSessionById(targetSessionId)

    const fallbackOk = await fallbackSession.write(payload)
    if (fallbackOk) {
      runtime.mode = runtime.mode === 'serial' ? 'tcp' : 'serial'
      runtime.connected = true
      runtime.lastError = null
      return
    }

    throw new Error(`会话[${targetSessionId}]未连接`)
  }

  private ensureSessionWired(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    if (this.sessionDisposers.has(targetSessionId)) {
      return
    }

    const runtime = this.getRuntimeState(targetSessionId)
    const tcpSession = window.tcp.getSessionById(targetSessionId)
    const serialSession = window.serial.getSessionById(targetSessionId)

    const disposers: Array<() => void> = []

    disposers.push(
      tcpSession.onConnect(() => {
        runtime.mode = 'tcp'
        runtime.connected = true
        runtime.lastError = null
      }),
      tcpSession.onClose(() => {
        if (runtime.mode !== 'tcp') return
        runtime.connected = false
      }),
      tcpSession.onError((payload: { message: string }) => {
        runtime.mode = 'tcp'
        runtime.connected = false
        runtime.lastError = payload.message
      })
    )

    disposers.push(
      serialSession.onOpen(() => {
        runtime.mode = 'serial'
        runtime.connected = true
        runtime.lastError = null
      }),
      serialSession.onClose(() => {
        if (runtime.mode !== 'serial') return
        runtime.connected = false
      }),
      serialSession.onError((payload: { message: string }) => {
        runtime.mode = 'serial'
        runtime.connected = false
        runtime.lastError = payload.message
      })
    )

    this.sessionDisposers.set(targetSessionId, disposers)
  }

  private getRuntimeState(sessionId: number): LedSessionRuntime {
    const targetSessionId = normalizeSessionId(sessionId)
    let state = this.sessionRuntime.get(targetSessionId)
    if (!state) {
      state = {
        mode: 'tcp',
        connected: false,
        lastError: null
      }
      this.sessionRuntime.set(targetSessionId, state)
    }
    return state
  }
}

export const ledSingleDevice = new LedDevice()

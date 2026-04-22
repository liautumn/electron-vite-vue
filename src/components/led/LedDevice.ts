import {
  transportSessionHub,
  type TransportConnectionMode
} from '../transport/TransportSessionHub'

export interface LedDeviceSnapshot {
  sessionId: number
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

  setActiveSession(sessionId: number) {
    this.activeSessionId = normalizeSessionId(sessionId)
  }

  getSnapshot(sessionId = this.activeSessionId): LedDeviceSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    const runtime = transportSessionHub.getSnapshot(targetSessionId)

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

    const payload = requireHexPayload(hex)
    await transportSessionHub.sendHex(payload, targetSessionId)
  }
}

export const ledSingleDevice = new LedDevice()

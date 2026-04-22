import {
  extractLockFixedLengthFrames,
  normalizeLockHex,
  requireLockHexPayload,
  parseLockFrame,
  type LockParsedFrame
} from './LockProtocol'
import {
  transportSessionHub,
  type TransportConnectionMode
} from '../transport/TransportSessionHub'

type LockStatusListener = (snapshot: LockDeviceSnapshot) => void
type LockRawDataListener = (sessionId: number, data: string) => void
type LockFrameListener = (sessionId: number, frame: LockParsedFrame) => void

export interface LockDeviceSnapshot {
  sessionId: number
  mode: TransportConnectionMode
  connected: boolean
  lastError: string | null
}

export interface LockRawResponseOptions {
  timeout?: number
  idleMs?: number
  optional?: boolean
}

type LockSessionState = {
  fixedFrameBuffer: string
}

const DEFAULT_LOCK_SESSION_ID = 0

const normalizeSessionId = (sessionId?: number) => {
  const parsed = Number(sessionId)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_LOCK_SESSION_ID
  }
  return parsed
}

const createSessionState = (): LockSessionState => ({
  fixedFrameBuffer: ''
})

class LockDevice {
  private initialized = false
  private activeSessionId = DEFAULT_LOCK_SESSION_ID

  private sessionStates = new Map<number, LockSessionState>()

  private statusListeners = new Set<LockStatusListener>()
  private rawDataListeners = new Set<LockRawDataListener>()
  private frameListeners = new Set<LockFrameListener>()

  setActiveSession(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.getSessionState(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  getSnapshot(sessionId = this.activeSessionId): LockDeviceSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
    const runtime = transportSessionHub.getSnapshot(targetSessionId)

    return {
      sessionId: targetSessionId,
      mode: runtime.mode,
      connected: runtime.connected,
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

  subscribeStatus(listener: LockStatusListener) {
    this.ensureInitialized()
    this.statusListeners.add(listener)
    listener(this.getSnapshot(this.activeSessionId))

    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeRawData(listener: LockRawDataListener) {
    this.ensureInitialized()
    this.rawDataListeners.add(listener)

    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  subscribeFrame(listener: LockFrameListener) {
    this.ensureInitialized()
    this.frameListeners.add(listener)

    return () => {
      this.frameListeners.delete(listener)
    }
  }

  async sendHex(hex: string, sessionId = this.activeSessionId) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.getSessionState(targetSessionId)

    const payload = requireLockHexPayload(hex)
    await transportSessionHub.sendHex(payload, targetSessionId)
  }

  async requestFrame(
    send: () => Promise<void> | void,
    matcher: (frame: LockParsedFrame) => boolean,
    timeout = 2000,
    sessionId = this.activeSessionId
  ) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)

    return await new Promise<LockParsedFrame>(async (resolve, reject) => {
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
        reject(new Error(`等待 Lock 固定响应超时(${timeout}ms)`))
      }, timeout)

      try {
        await send()
      } catch (error) {
        cleanup(dispose)
        reject(error)
      }
    })
  }

  async requestRawResponse(
    send: () => Promise<void> | void,
    options: LockRawResponseOptions = {},
    sessionId = this.activeSessionId
  ) {
    this.ensureInitialized()

    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
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

        reject(error ?? new Error(`等待 Lock 原始响应超时(${timeout}ms)`))
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
        finish('timeout', new Error(`等待 Lock 原始响应超时(${timeout}ms)`))
      }, timeout)

      try {
        await send()
      } catch (error) {
        finish('error', error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private ensureInitialized() {
    if (this.initialized) {
      return
    }

    this.initialized = true

    transportSessionHub.subscribeStatus((snapshot) => {
      this.emitStatus(snapshot.sessionId)
    })

    transportSessionHub.subscribeData((sessionId, _mode, data) => {
      this.handleIncomingData(sessionId, data)
    })
  }

  private emitStatus(sessionId: number) {
    const snapshot = this.getSnapshot(sessionId)
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  private handleIncomingData(sessionId: number, data: string) {
    const normalized = normalizeLockHex(data)
    if (!normalized) {
      return
    }

    this.rawDataListeners.forEach((listener) => {
      listener(sessionId, normalized)
    })

    const state = this.getSessionState(sessionId)
    state.fixedFrameBuffer += normalized

    const extracted = extractLockFixedLengthFrames(state.fixedFrameBuffer)
    state.fixedFrameBuffer = extracted.rest

    extracted.frames.forEach((frameHex) => {
      const frame = parseLockFrame(frameHex)
      if (!frame) {
        return
      }
      this.frameListeners.forEach((listener) => {
        listener(sessionId, frame)
      })
    })
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
}

export const lockDevice = new LockDevice()

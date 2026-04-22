import {
  extractLockFixedLengthFrames,
  normalizeLockHex,
  requireLockHexPayload,
  parseLockFrame,
  type LockParsedFrame
} from './LockProtocol'
import type { TransportConnectionMode } from '../../types/connection'

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

type LockSessionRuntime = {
  mode: TransportConnectionMode
  connected: boolean
  lastError: string | null
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
  private activeSessionId = DEFAULT_LOCK_SESSION_ID

  private sessionStates = new Map<number, LockSessionState>()
  private sessionRuntime = new Map<number, LockSessionRuntime>()
  private sessionDisposers = new Map<number, Array<() => void>>()

  private statusListeners = new Set<LockStatusListener>()
  private rawDataListeners = new Set<LockRawDataListener>()
  private frameListeners = new Set<LockFrameListener>()

  setActiveSession(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.getSessionState(targetSessionId)
    this.ensureSessionWired(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  getSnapshot(sessionId = this.activeSessionId): LockDeviceSnapshot {
    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
    const runtime = this.getRuntimeState(targetSessionId)

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
    this.statusListeners.add(listener)
    listener(this.getSnapshot(this.activeSessionId))

    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribeRawData(listener: LockRawDataListener) {
    this.rawDataListeners.add(listener)

    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  subscribeFrame(listener: LockFrameListener) {
    this.frameListeners.add(listener)

    return () => {
      this.frameListeners.delete(listener)
    }
  }

  async sendHex(hex: string, sessionId = this.activeSessionId) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.activeSessionId = targetSessionId
    this.getSessionState(targetSessionId)
    this.ensureSessionWired(targetSessionId)

    const payload = requireLockHexPayload(hex)
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
        this.emitStatus(targetSessionId)
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
      this.emitStatus(targetSessionId)
      return
    }

    throw new Error(`会话[${targetSessionId}]未连接`)
  }

  async requestFrame(
    send: () => Promise<void> | void,
    matcher: (frame: LockParsedFrame) => boolean,
    timeout = 2000,
    sessionId = this.activeSessionId
  ) {
    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
    this.ensureSessionWired(targetSessionId)

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
    const targetSessionId = normalizeSessionId(sessionId)
    this.getSessionState(targetSessionId)
    this.ensureSessionWired(targetSessionId)
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
        const runtime = this.getRuntimeState(targetSessionId)
        runtime.mode = 'tcp'
        runtime.connected = true
        runtime.lastError = null
        this.emitStatus(targetSessionId)
      }),
      tcpSession.onClose(() => {
        const runtime = this.getRuntimeState(targetSessionId)
        if (runtime.mode !== 'tcp') return
        runtime.connected = false
        this.emitStatus(targetSessionId)
      })
    )

    disposers.push(
      tcpSession.onError((payload: { message: string }) => {
        const runtime = this.getRuntimeState(targetSessionId)
        runtime.mode = 'tcp'
        runtime.connected = false
        runtime.lastError = payload.message
        this.emitStatus(targetSessionId)
      }),
      tcpSession.onData((payload: { data: string }) => {
        const runtime = this.getRuntimeState(targetSessionId)
        runtime.mode = 'tcp'
        this.handleIncomingData(targetSessionId, payload.data)
      })
    )

    disposers.push(
      serialSession.onOpen(() => {
        const runtime = this.getRuntimeState(targetSessionId)
        runtime.mode = 'serial'
        runtime.connected = true
        runtime.lastError = null
        this.emitStatus(targetSessionId)
      }),
      serialSession.onClose(() => {
        const runtime = this.getRuntimeState(targetSessionId)
        if (runtime.mode !== 'serial') return
        runtime.connected = false
        this.emitStatus(targetSessionId)
      })
    )

    disposers.push(
      serialSession.onError((payload: { message: string }) => {
        const runtime = this.getRuntimeState(targetSessionId)
        runtime.mode = 'serial'
        runtime.connected = false
        runtime.lastError = payload.message
        this.emitStatus(targetSessionId)
      }),
      serialSession.onData((payload: { data: string }) => {
        const runtime = this.getRuntimeState(targetSessionId)
        runtime.mode = 'serial'
        this.handleIncomingData(targetSessionId, payload.data)
      })
    )

    this.sessionDisposers.set(targetSessionId, disposers)
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

  private getRuntimeState(sessionId: number): LockSessionRuntime {
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

export const lockDevice = new LockDevice()

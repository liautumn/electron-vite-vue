// 引入 Lock 协议层的拆帧、校验和解析工具。
import {
  extractLockFixedLengthFrames,
  normalizeLockHex,
  requireLockHexPayload,
  parseLockFrame,
  type LockParsedFrame
} from './LockProtocol'
// Electron 侧事件类型，仅用于标注事件回调入参。
import type { IpcRendererEvent } from 'electron'

// 只带会话 ID 的串口事件结构。
type SerialSessionEvent = {
  // 对应的会话 ID。
  sessionId: number
}

// 带原始数据的串口事件结构。
type SerialDataEvent = SerialSessionEvent & {
  // 原始 HEX 数据。
  data: string
}

// 带错误消息的串口事件结构。
type SerialErrorEvent = SerialSessionEvent & {
  // 错误文案。
  message: string
}

// 设备状态订阅回调。
type LockStatusListener = (snapshot: LockDeviceSnapshot) => void
// 原始数据订阅回调。
type LockRawDataListener = (sessionId: number, data: string) => void
// 结构化帧订阅回调。
type LockFrameListener = (sessionId: number, frame: LockParsedFrame) => void

// 页面感知到的 Lock 设备快照。
export interface LockDeviceSnapshot {
  // 当前快照对应的会话 ID。
  sessionId: number
  // 是否已连接。
  connected: boolean
  // 当前串口路径。
  portPath: string
  // 当前波特率。
  baudRate: number
  // 最近一次错误信息。
  lastError: string | null
}

// 原始响应等待参数，主要给 9A/9B 这类长度不稳定的指令使用。
export interface LockRawResponseOptions {
  // 总超时时间。
  timeout?: number
  // 数据静默多久后视为一段响应结束。
  idleMs?: number
  // 超时无响应时是否允许返回空串。
  optional?: boolean
}

// Lock 单个会话的内部状态。
type LockSessionState = {
  // 当前会话是否已连接。
  connected: boolean
  // 当前串口路径。
  portPath: string
  // 当前波特率。
  baudRate: number
  // 最近一次错误文案。
  lastError: string | null
  // 固定长度响应的半包缓冲。
  fixedFrameBuffer: string
}

// 默认会话 ID。
const DEFAULT_LOCK_SESSION_ID = 0
// 默认波特率。
const DEFAULT_LOCK_BAUD_RATE = 9600

// 把任意输入规范成合法的非负整数会话 ID。
const normalizeSessionId = (sessionId?: number) => {
  // 尝试转成数字。
  const parsed = Number(sessionId)
  // 非整数或负数一律回退到默认会话。
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_LOCK_SESSION_ID
  }
  // 返回规范化后的会话 ID。
  return parsed
}

// 构造一份新的默认会话状态。
const createSessionState = (): LockSessionState => ({
  // 初始未连接。
  connected: false,
  // 初始串口路径为空。
  portPath: '',
  // 初始波特率为默认值。
  baudRate: DEFAULT_LOCK_BAUD_RATE,
  // 初始没有错误。
  lastError: null,
  // 初始半包缓冲为空。
  fixedFrameBuffer: ''
})

// Lock 单设备单例：负责会话状态、串口收发和响应等待。
class LockDevice {
  // 避免重复绑定 Electron 事件。
  private initialized = false

  // 当前激活会话 ID，供未显式传参的方法兜底使用。
  private activeSessionId = DEFAULT_LOCK_SESSION_ID

  // 会话状态池。
  private sessionStates = new Map<number, LockSessionState>()

  // 各类订阅器集合。
  private statusListeners = new Set<LockStatusListener>()
  private rawDataListeners = new Set<LockRawDataListener>()
  private frameListeners = new Set<LockFrameListener>()

  // 切换当前激活会话。
  setActiveSession(sessionId: number) {
    // 先规范化会话 ID。
    const targetSessionId = normalizeSessionId(sessionId)
    // 更新当前默认会话。
    this.activeSessionId = targetSessionId
    // 确保该会话状态对象存在。
    this.getSessionState(targetSessionId)
    // 主动广播当前会话状态。
    this.emitStatus(targetSessionId)
  }

  // 对外返回指定会话状态快照。
  getSnapshot(sessionId = this.activeSessionId): LockDeviceSnapshot {
    // 先规范化会话 ID。
    const targetSessionId = normalizeSessionId(sessionId)
    // 取出会话状态。
    const state = this.getSessionState(targetSessionId)

    return {
      // 快照对应的会话 ID。
      sessionId: targetSessionId,
      // 当前连接状态。
      connected: state.connected,
      // 当前串口路径。
      portPath: state.portPath,
      // 当前波特率。
      baudRate: state.baudRate,
      // 最近错误文案。
      lastError: state.lastError
    }
  }

  // 返回当前所有已初始化会话快照。
  getSnapshots() {
    // 还没有任何会话时，返回当前激活会话的默认快照。
    if (!this.sessionStates.size) {
      return [this.getSnapshot(this.activeSessionId)]
    }

    // 已存在会话时，按会话 ID 升序输出全部快照。
    return Array.from(this.sessionStates.keys())
      .sort((a, b) => a - b)
      .map((sessionId) => this.getSnapshot(sessionId))
  }

  // 透传串口列表查询，页面用于选择连接目标。
  async listPorts() {
    return window.serial.list()
  }

  // 订阅设备状态，订阅后立即回推一次当前激活会话状态。
  subscribeStatus(listener: LockStatusListener) {
    // 确保底层事件已经绑定。
    this.ensureInitialized()
    // 注册状态监听器。
    this.statusListeners.add(listener)
    // 立刻推送当前激活会话状态。
    listener(this.getSnapshot(this.activeSessionId))
    // 返回取消订阅函数。
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  // 订阅原始 HEX 数据，便于保留原始收包内容。
  subscribeRawData(listener: LockRawDataListener) {
    // 确保底层事件已经绑定。
    this.ensureInitialized()
    // 注册原始数据监听器。
    this.rawDataListeners.add(listener)
    // 返回取消订阅函数。
    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  // 订阅已经解析完成的固定长度帧。
  subscribeFrame(listener: LockFrameListener) {
    // 确保底层事件已经绑定。
    this.ensureInitialized()
    // 注册帧监听器。
    this.frameListeners.add(listener)
    // 返回取消订阅函数。
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  // 连接串口并刷新指定会话上下文。
  async connectSerial(options: { sessionId?: number; path: string; baudRate: number }) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 规范化目标会话。
    const targetSessionId = normalizeSessionId(options.sessionId)
    // 切换当前默认会话。
    this.activeSessionId = targetSessionId

    // 读取/初始化会话状态。
    const state = this.getSessionState(targetSessionId)

    // 如果当前会话已经连接，先主动断开再重连。
    if (state.connected) {
      await this.disconnect(targetSessionId)
    }

    // 记录串口路径。
    state.portPath = options.path
    // 记录波特率。
    state.baudRate = options.baudRate
    // 连接建立前先标记为未连接。
    state.connected = false
    // 清空旧错误。
    state.lastError = null
    // 清空历史半包缓冲。
    this.resetRxBuffer(targetSessionId)
    // 广播一次“正在以新配置准备连接”的状态。
    this.emitStatus(targetSessionId)

    // 真正调用底层串口打开。
    await window.serial.open({
      sessionId: targetSessionId,
      path: options.path,
      baudRate: options.baudRate
    })
  }

  // 主动断开指定会话串口连接。
  async disconnect(sessionId = this.activeSessionId) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 规范化目标会话。
    const targetSessionId = normalizeSessionId(sessionId)
    // 切换当前默认会话。
    this.activeSessionId = targetSessionId

    // 先通知底层关闭串口。
    await window.serial.close(targetSessionId)

    // 再同步更新本地会话状态。
    const state = this.getSessionState(targetSessionId)
    state.connected = false
    this.resetRxBuffer(targetSessionId)
    this.emitStatus(targetSessionId)
  }

  // 按指定会话发送一条完整 HEX 指令。
  async sendHex(hex: string, sessionId = this.activeSessionId) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 规范化目标会话。
    const targetSessionId = normalizeSessionId(sessionId)
    // 切换当前默认会话。
    this.activeSessionId = targetSessionId

    // 取出会话状态。
    const state = this.getSessionState(targetSessionId)
    // 未连接时直接报错，不允许盲发。
    if (!state.connected) {
      throw new Error(`Lock 会话[${targetSessionId}]未连接`)
    }

    // 校验并规范化要发送的 HEX。
    const payload = requireLockHexPayload(hex)
    // 交给底层串口发送。
    await window.serial.write(payload, targetSessionId)
  }

  // 等待一条固定长度且满足条件的响应帧。
  async requestFrame(
    // 真正执行发送动作的函数。
    send: () => Promise<void> | void,
    // 用于筛选目标响应帧的匹配器。
    matcher: (frame: LockParsedFrame) => boolean,
    // 超时时间，默认 2 秒。
    timeout = 2000,
    // 目标会话，默认当前激活会话。
    sessionId = this.activeSessionId
  ) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 规范化目标会话。
    const targetSessionId = normalizeSessionId(sessionId)

    return await new Promise<LockParsedFrame>(async (resolve, reject) => {
      // 保存超时定时器句柄。
      let timer: ReturnType<typeof setTimeout> | undefined

      // 统一封装清理逻辑。
      const cleanup = (dispose: () => void) => {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
        dispose()
      }

      // 先注册帧监听器，再发命令，避免设备回太快导致漏帧。
      const dispose = this.subscribeFrame((incomingSessionId, frame) => {
        // 只关注目标会话的数据。
        if (incomingSessionId !== targetSessionId) {
          return
        }
        // 只接受匹配器认定为目标响应的帧。
        if (!matcher(frame)) {
          return
        }
        // 命中目标帧后，先清理现场。
        cleanup(dispose)
        // 再把帧返回给调用方。
        resolve(frame)
      })

      // 启动超时定时器。
      timer = setTimeout(() => {
        cleanup(dispose)
        reject(new Error(`等待 Lock 固定响应超时(${timeout}ms)`))
      }, timeout)

      try {
        // 发送实际命令。
        await send()
      } catch (error) {
        // 发送失败时也要释放监听器。
        cleanup(dispose)
        reject(error)
      }
    })
  }

  // 等待一段原始响应数据，适合 9A/9B 这种长度不稳定的命令。
  async requestRawResponse(
    // 真正执行发送动作的函数。
    send: () => Promise<void> | void,
    // 原始响应等待参数。
    options: LockRawResponseOptions = {},
    // 目标会话，默认当前激活会话。
    sessionId = this.activeSessionId
  ) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 规范化目标会话。
    const targetSessionId = normalizeSessionId(sessionId)
    // 带上默认值，补齐超时、静默时长和 optional 标志。
    const { timeout = 2000, idleMs = 120, optional = false } = options

    return await new Promise<string>(async (resolve, reject) => {
      // 总超时定时器。
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined
      // 静默结束定时器。
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      // 累积收到的原始响应 HEX。
      let responseHex = ''

      // 统一清理定时器和订阅。
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

      // 统一结束 Promise 的入口。
      const finish = (result: 'success' | 'timeout' | 'error', error?: Error) => {
        cleanup()

        // 成功时返回累积的原始响应。
        if (result === 'success') {
          resolve(responseHex)
          return
        }

        // 允许可选响应时，超时直接返回空串。
        if (result === 'timeout' && optional) {
          resolve('')
          return
        }

        // 其它情况都按错误结束。
        reject(error ?? new Error(`等待 Lock 原始响应超时(${timeout}ms)`))
      }

      // 每次收到新数据后重新计时，静默一段时间即认为一段响应结束。
      const scheduleIdleFinish = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
        }
        idleTimer = setTimeout(() => {
          finish('success')
        }, idleMs)
      }

      // 先挂原始数据监听器，再发送命令。
      const dispose = this.subscribeRawData((incomingSessionId, chunk) => {
        // 只收目标会话的数据。
        if (incomingSessionId !== targetSessionId) {
          return
        }

        // 把本次数据拼到原始响应缓冲里。
        responseHex += chunk
        // 刷新静默结束计时器。
        scheduleIdleFinish()
      })

      // 启动总超时计时器。
      timeoutTimer = setTimeout(() => {
        // 超时前如果已经收到过数据，就把它当成一次完整响应返回。
        if (responseHex) {
          finish('success')
          return
        }
        // 完全没有响应时按超时处理。
        finish('timeout', new Error(`等待 Lock 原始响应超时(${timeout}ms)`))
      }, timeout)

      try {
        // 真正执行发送。
        await send()
      } catch (error) {
        // 发送失败直接按 error 分支结束。
        finish('error', error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  // 延迟完成 Electron 事件绑定，保证全局只初始化一次。
  private ensureInitialized() {
    // 已经初始化过就直接返回。
    if (this.initialized) {
      return
    }

    // 标记为已初始化。
    this.initialized = true

    // 监听串口打开事件。
    window.serial.onOpen((_event: IpcRendererEvent, payload: SerialSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = true
      state.lastError = null
      this.emitStatus(sessionId)
    })

    // 监听串口关闭事件。
    window.serial.onClose((_event: IpcRendererEvent, payload: SerialSessionEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = false
      this.resetRxBuffer(sessionId)
      this.emitStatus(sessionId)
    })

    // 监听串口错误事件。
    window.serial.onError((_event: IpcRendererEvent, payload: SerialErrorEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      state.connected = false
      state.lastError = payload.message
      this.resetRxBuffer(sessionId)
      this.emitStatus(sessionId)
    })

    // 监听串口数据事件。
    window.serial.onData((_event: IpcRendererEvent, payload: SerialDataEvent) => {
      const sessionId = normalizeSessionId(payload.sessionId)
      const state = this.getSessionStateIfExists(sessionId)
      if (!state) {
        return
      }

      this.handleIncomingData(sessionId, payload.data)
    })
  }

  // 向所有状态订阅者广播指定会话快照。
  private emitStatus(sessionId: number) {
    const snapshot = this.getSnapshot(sessionId)
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  // 处理指定会话新收到的原始串口数据：先转 HEX，再拆固定长度响应。
  private handleIncomingData(sessionId: number, data: string) {
    // 先规范化当前数据块。
    const normalized = normalizeLockHex(data)
    // 空数据直接忽略。
    if (!normalized) {
      return
    }

    // 先把原始数据广播给原始监听器。
    this.rawDataListeners.forEach((listener) => {
      listener(sessionId, normalized)
    })

    // 取出目标会话状态。
    const state = this.getSessionState(sessionId)
    // 把当前数据块并入固定长度半包缓冲。
    state.fixedFrameBuffer += normalized

    // 尝试从半包缓冲中提取完整固定长度帧。
    const extracted = extractLockFixedLengthFrames(state.fixedFrameBuffer)
    // 把未消费完的尾巴写回缓冲，等待下一块数据继续拼。
    state.fixedFrameBuffer = extracted.rest

    // 把本次提取出的每一帧解析并广播给帧监听器。
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

  // 清空指定会话固定长度响应半包缓冲。
  private resetRxBuffer(sessionId: number) {
    const state = this.getSessionState(sessionId)
    state.fixedFrameBuffer = ''
  }

  // 获取会话状态；不存在时自动初始化。
  private getSessionState(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    let state = this.sessionStates.get(targetSessionId)
    if (!state) {
      state = createSessionState()
      this.sessionStates.set(targetSessionId, state)
    }
    return state
  }

  // 仅获取已初始化会话状态；不存在时返回 null。
  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

// Lock 设备在项目层维护一个会话池单例。
export const lockDevice = new LockDevice()

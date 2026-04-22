// 引入 HEX 规范化工具，串口/TCP 收发都会用到。
import { normalizeHex } from './GuoXinCommon'
// Electron 侧事件类型，仅用于标注回调入参。
import type { IpcRendererEvent } from 'electron'

// 只带会话 ID 的连接事件结构。
type ConnectionSessionEvent = {
  // 事件对应的设备会话 ID。
  sessionId: number
}

// 带原始数据的连接事件结构。
type ConnectionDataEvent = ConnectionSessionEvent & {
  // 原始 HEX 数据。
  data: string
}

// 带错误消息的连接事件结构。
type ConnectionErrorEvent = ConnectionSessionEvent & {
  // 错误描述。
  message: string
}

// 国芯设备当前支持两种连接方式：串口或 TCP。
export type GuoxinConnectionMode = 'serial' | 'tcp'

// 业务层订阅的“完整协议帧”监听器。
type GuoXinDataListener = (data: string) => void

// 原始帧监听器，调试面板会用到。
type GuoXinRawDataListener = (
  // 数据所属会话。
  sessionId: number,
  // 数据来源连接方式。
  source: GuoxinConnectionMode,
  // 已切好的完整帧。
  data: string
) => void

// 状态监听器，页面用于同步连接状态和天线数量。
type GuoXinStatusListener = (state: GuoxinDeviceSnapshot) => void

// 暴露给页面层的国芯设备快照。
export interface GuoxinDeviceSnapshot {
  // 当前连接模式。
  mode: GuoxinConnectionMode
  // 会话 ID。
  sessionId: number
  // 是否已连接。
  connected: boolean
  // 当前天线数量。
  antNum: number
  // 最近一次错误信息。
  lastError: string | null
}

// 内部维护的会话状态对象。
type GuoxinSessionState = {
  // 当前会话正在使用的连接模式。
  mode: GuoxinConnectionMode
  // 连接状态。
  connected: boolean
  // 当前会话配置的天线数量。
  antNum: number
  // 最近一次错误信息。
  lastError: string | null
  // 每种连接方式各自独立维护一个半包缓冲。
  rxBuffers: Record<GuoxinConnectionMode, string>
}

// 默认会话 ID。
const DEFAULT_GUOXIN_SESSION_ID = 0
// 默认天线数量。
const DEFAULT_GUOXIN_ANT_NUM = 4
// 国芯协议帧头。
const FRAME_HEAD = '5A'
// 只包含帧头/控制字/长度字段时的最小字符数。
const FRAME_MIN_HEAD_CHARS = 14
// 帧固定部分长度：帧头 2 + 控制字 8 + 长度 4 + CRC 4。
const FRAME_FIXED_CHARS = 18

// 把任意输入会话值规范成一个合法的非负整数。
const normalizeSessionId = (sessionId?: number) => {
  // 尝试转换成数字。
  const parsed = Number(sessionId)
  // 非整数或负数都回退到默认会话。
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_GUOXIN_SESSION_ID
  }
  // 返回规范化后的会话 ID。
  return parsed
}

// 构造一份新的默认会话状态。
const createSessionState = (): GuoxinSessionState => ({
  // 默认优先按 TCP 模式初始化。
  mode: 'tcp',
  // 初始未连接。
  connected: false,
  // 默认 4 路天线。
  antNum: DEFAULT_GUOXIN_ANT_NUM,
  // 初始没有错误。
  lastError: null,
  rxBuffers: {
    // 串口半包缓冲。
    serial: '',
    // TCP 半包缓冲。
    tcp: ''
  }
})

// 按会话维护国芯设备状态、监听器和半包缓冲的单例。
class GuoXinDevice {
  // 标记 Electron 事件是否已经绑定，避免重复订阅。
  private initialized = false
  // 当前默认激活的会话 ID。
  private activeSessionId = DEFAULT_GUOXIN_SESSION_ID

  // 所有会话的状态池。
  private sessionStates = new Map<number, GuoxinSessionState>()
  // 每个会话自己的命令帧监听器集合。
  private commandDataListeners = new Map<number, Set<GuoXinDataListener>>()
  // 原始帧监听器集合。
  private rawDataListeners = new Set<GuoXinRawDataListener>()
  // 状态监听器集合。
  private statusListeners = new Set<GuoXinStatusListener>()

  // 当前激活会话的天线数快捷访问器。
  get antNum() {
    return this.getSessionState(this.activeSessionId).antNum
  }

  // 当前激活会话的连接模式快捷访问器。
  get currentMode() {
    return this.getSessionState(this.activeSessionId).mode
  }

  // 当前激活会话 ID 快捷访问器。
  get currentSessionId() {
    return this.activeSessionId
  }

  // 当前激活会话的连接状态快捷访问器。
  get isConnected() {
    return this.getSessionState(this.activeSessionId).connected
  }

  // 切换当前激活会话，并立即把该会话状态广播给页面。
  setActiveSession(sessionId: number) {
    // 先规范化并激活目标会话。
    const targetSessionId = this.activateSession(sessionId)
    // 确保目标会话状态对象已存在。
    this.getSessionState(targetSessionId)
    // 主动广播一次最新状态。
    this.emitStatus(targetSessionId)
  }

  // 读取指定会话的天线数量，默认读取当前会话。
  getAntNum(sessionId = this.activeSessionId) {
    return this.getSessionState(sessionId).antNum
  }

  // 设置指定会话的天线数量。
  setAntNum(antNum: number, sessionId = this.activeSessionId) {
    // 天线数量必须是正整数。
    if (!Number.isInteger(antNum) || antNum <= 0) {
      throw new Error('天线数量必须是大于 0 的整数')
    }

    // 先规范化会话 ID。
    const targetSessionId = normalizeSessionId(sessionId)
    // 取出目标会话状态。
    const state = this.getSessionState(targetSessionId)
    // 数量没变化时不重复广播。
    if (state.antNum === antNum) {
      return
    }

    // 写入新天线数量。
    state.antNum = antNum
    // 广播状态变化。
    this.emitStatus(targetSessionId)
  }

  // 获取指定会话的快照对象。
  getSnapshot(sessionId = this.activeSessionId): GuoxinDeviceSnapshot {
    // 先规范化会话 ID。
    const targetSessionId = normalizeSessionId(sessionId)
    // 取出会话状态。
    const state = this.getSessionState(targetSessionId)

    return {
      // 当前连接模式。
      mode: state.mode,
      // 快照对应的会话 ID。
      sessionId: targetSessionId,
      // 当前连接状态。
      connected: state.connected,
      // 当前天线数量。
      antNum: state.antNum,
      // 最近错误信息。
      lastError: state.lastError
    }
  }

  // 获取当前已经初始化过的所有会话快照。
  getSnapshots() {
    // 如果还没有任何会话，就返回当前激活会话的默认快照。
    if (!this.sessionStates.size) {
      return [this.getSnapshot(this.activeSessionId)]
    }

    // 否则按会话 ID 升序输出全部快照。
    return Array.from(this.sessionStates.keys())
      .sort((a, b) => a - b)
      .map((sessionId) => this.getSnapshot(sessionId))
  }

  // 订阅状态变化；订阅成功后立即推送一次当前激活会话状态。
  subscribeStatus(listener: GuoXinStatusListener) {
    // 确保底层 Electron 事件已经绑定。
    this.ensureInitialized()
    // 加入监听集合。
    this.statusListeners.add(listener)
    // 立刻推一份当前激活会话快照。
    listener(this.getSnapshot(this.activeSessionId))

    // 返回取消订阅函数。
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  // 订阅切帧后的原始协议帧，调试面板常用。
  subscribeRawData(listener: GuoXinRawDataListener) {
    // 确保底层事件已初始化。
    this.ensureInitialized()
    // 注册原始帧监听器。
    this.rawDataListeners.add(listener)

    // 返回取消订阅函数。
    return () => {
      this.rawDataListeners.delete(listener)
    }
  }

  // 修改指定会话的连接模式。
  setMode(mode: GuoxinConnectionMode, sessionId = this.activeSessionId) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 激活并规范化目标会话。
    const targetSessionId = this.activateSession(sessionId)
    // 获取目标会话状态。
    const state = this.getSessionState(targetSessionId)

    // 写入新模式。
    state.mode = mode
    // 切换模式时先把连接状态置为未连接。
    state.connected = false
    // 清空旧错误。
    state.lastError = null
    // 重置两种模式下的半包缓冲。
    this.resetRxBuffers(targetSessionId)

    // 广播状态变化。
    this.emitStatus(targetSessionId)
  }

  // 按串口方式连接指定会话。
  async connectSerial(options: { sessionId?: number; path: string; baudRate: number }) {
    // 复用统一的模式连接逻辑，只是 connectAction 换成串口打开。
    await this.connectByMode('serial', options.sessionId, (sessionId) => {
      return window.serial.open({
        sessionId,
        path: options.path,
        baudRate: options.baudRate
      })
    })
  }

  // 按 TCP 方式连接指定会话。
  async connectTcp(options: { sessionId?: number; host: string; port: number }) {
    // 复用统一的模式连接逻辑，只是 connectAction 换成 TCP 连接。
    await this.connectByMode('tcp', options.sessionId, (sessionId) => {
      return window.tcp.connect({
        sessionId,
        host: options.host,
        port: options.port
      })
    })
  }

  // 断开指定会话的连接；如果未传 mode，则按当前会话模式断开。
  async disconnect(mode?: GuoxinConnectionMode, sessionId = this.activeSessionId) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 激活目标会话。
    const targetSessionId = this.activateSession(sessionId)
    // 获取目标会话状态。
    const state = this.getSessionState(targetSessionId)
    // 断开模式优先用显式传入的 mode，否则回退到会话当前模式。
    const targetMode = mode ?? state.mode

    // 串口模式走 serial.close。
    if (targetMode === 'serial') {
      await window.serial.close(targetSessionId)
    } else {
      // TCP 模式走 tcp.disconnect。
      await window.tcp.disconnect(targetSessionId)
    }

    // 断开后要清掉该模式的半包缓冲。
    this.resetRxBuffer(targetSessionId, targetMode)

    // 如果当前会话模式已经不是本次断开的模式，说明状态已切换，不再重复覆盖 connected。
    if (state.mode !== targetMode) {
      return
    }

    // 标记为未连接。
    state.connected = false
    // 广播状态变化。
    this.emitStatus(targetSessionId)
  }

  // 向指定会话发送一条完整 HEX 指令。
  sendMessageNew(hex: string, sessionId = this.activeSessionId) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 激活目标会话。
    const targetSessionId = this.activateSession(sessionId)
    // 取出会话状态。
    const state = this.getSessionState(targetSessionId)

    // 未连接时直接报错，不允许盲发。
    if (!state.connected) {
      throw new Error(`国芯 RFID 会话[${targetSessionId}]未连接`)
    }

    // 发包前统一规范成连续大写 HEX。
    const payload = normalizeHex(hex)

    // 串口模式走 serial.write。
    if (state.mode === 'serial') {
      void window.serial.write(payload, targetSessionId)
      return
    }

    // TCP 模式走 tcp.write。
    void window.tcp.write(payload, targetSessionId)
  }

  // 给某个会话注册完整帧监听器。
  on(listener: GuoXinDataListener, sessionId = this.activeSessionId) {
    // 确保底层事件已绑定。
    this.ensureInitialized()
    // 规范化目标会话。
    const targetSessionId = normalizeSessionId(sessionId)
    // 注册到该会话自己的监听器集合里。
    this.getCommandListeners(targetSessionId).add(listener)
  }

  // 移除某个会话的完整帧监听器；未传 listener 时清空该会话全部监听器。
  off(listener?: GuoXinDataListener, sessionId = this.activeSessionId) {
    // 规范化目标会话。
    const targetSessionId = normalizeSessionId(sessionId)
    // 读取该会话监听器集合。
    const listeners = this.commandDataListeners.get(targetSessionId)
    // 没有集合说明无需处理。
    if (!listeners) {
      return
    }

    // 传了具体 listener 时，只删这一条。
    if (listener) {
      listeners.delete(listener)
      // 删完为空时顺便移除整个 Set。
      if (!listeners.size) {
        this.commandDataListeners.delete(targetSessionId)
      }
      return
    }

    // 未传具体 listener 时，清空整个会话的监听器集合。
    listeners.clear()
    this.commandDataListeners.delete(targetSessionId)
  }

  // 规范化并激活一个会话 ID，同时更新当前默认会话。
  private activateSession(sessionId?: number) {
    // 先规范化会话值。
    const targetSessionId = normalizeSessionId(sessionId)
    // 更新当前激活会话。
    this.activeSessionId = targetSessionId
    // 返回目标会话 ID，便于链式复用。
    return targetSessionId
  }

  // 按连接模式执行统一的连接流程。
  private async connectByMode(
    // 目标连接模式。
    mode: GuoxinConnectionMode,
    // 原始会话 ID。
    sessionId: number | undefined,
    // 真正执行连接的动作函数。
    connectAction: (sessionId: number) => Promise<boolean | void>
  ) {
    // 确保底层事件已绑定。
    this.ensureInitialized()

    // 激活目标会话。
    const targetSessionId = this.activateSession(sessionId)
    // 获取目标会话状态。
    const state = this.getSessionState(targetSessionId)

    // 如果当前已连接但模式不同，先断开旧模式。
    if (state.connected && state.mode !== mode) {
      await this.disconnect(state.mode, targetSessionId)
    }

    // 写入新模式。
    state.mode = mode
    // 清空旧错误。
    state.lastError = null
    // 重置当前模式缓冲。
    this.resetRxBuffer(targetSessionId, mode)
    // 连接开始前先广播一次状态。
    this.emitStatus(targetSessionId)

    // 最后真正执行连接。
    await connectAction(targetSessionId)
  }

  // 确保底层 Electron 事件只绑定一次。
  private ensureInitialized() {
    // 已初始化则直接返回。
    if (this.initialized) {
      return
    }

    // 标记初始化完成。
    this.initialized = true
    // 绑定串口事件。
    this.bindSerialEvents()
    // 绑定 TCP 事件。
    this.bindTcpEvents()
  }

  // 绑定 window.serial 相关事件。
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

  // 绑定 window.tcp 相关事件。
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

  // 处理连接成功事件。
  private handleConnected(mode: GuoxinConnectionMode, rawSessionId: number) {
    // 规范化会话 ID。
    const sessionId = normalizeSessionId(rawSessionId)
    // 只处理已经存在的会话。
    const state = this.getSessionStateIfExists(sessionId)
    // 模式不匹配时说明这条事件不属于当前会话上下文。
    if (!state || state.mode !== mode) {
      return
    }

    // 标记连接成功。
    state.connected = true
    // 清空错误信息。
    state.lastError = null
    // 广播状态变化。
    this.emitStatus(sessionId)
  }

  // 处理连接关闭事件。
  private handleDisconnected(mode: GuoxinConnectionMode, rawSessionId: number) {
    // 规范化会话 ID。
    const sessionId = normalizeSessionId(rawSessionId)
    // 仅读取已存在会话。
    const state = this.getSessionStateIfExists(sessionId)
    // 模式不匹配则忽略。
    if (!state || state.mode !== mode) {
      return
    }

    // 标记为未连接。
    state.connected = false
    // 清掉对应模式的半包缓冲。
    this.resetRxBuffer(sessionId, mode)
    // 广播状态变化。
    this.emitStatus(sessionId)
  }

  // 处理连接错误事件。
  private handleError(mode: GuoxinConnectionMode, payload: ConnectionErrorEvent) {
    // 规范化会话 ID。
    const sessionId = normalizeSessionId(payload.sessionId)
    // 仅读取已存在会话。
    const state = this.getSessionStateIfExists(sessionId)
    // 模式不匹配则忽略。
    if (!state || state.mode !== mode) {
      return
    }

    // 错误后认为连接已不可用。
    state.connected = false
    // 记录错误信息。
    state.lastError = payload.message
    // 重置该模式半包缓冲。
    this.resetRxBuffer(sessionId, mode)
    // 广播状态变化。
    this.emitStatus(sessionId)
  }

  // 处理底层新收到的数据块。
  private handleIncomingData(mode: GuoxinConnectionMode, payload: ConnectionDataEvent) {
    // 规范化会话 ID。
    const sessionId = normalizeSessionId(payload.sessionId)
    // 未初始化的会话直接忽略，避免脏数据误入。
    if (!this.getSessionStateIfExists(sessionId)) {
      return
    }

    // 进入统一的数据分发流程。
    this.emitData(mode, sessionId, payload.data)
  }

  // 把一段原始输入先切成完整帧，再按会话分发给监听器。
  private emitData(source: GuoxinConnectionMode, sessionId: number, data: string) {
    // 读取会话状态。
    const state = this.getSessionStateIfExists(sessionId)
    // 没有状态说明无需处理。
    if (!state) {
      return
    }

    // 尝试把这段输入与历史半包拼接后切成完整帧。
    const frames = this.handleNewRx(sessionId, source, data)
    // 一帧都切不出来时不做任何分发。
    if (!frames.length) {
      return
    }

    // 取出当前会话的命令帧监听器集合。
    const sessionListeners = this.commandDataListeners.get(sessionId)

    // 逐帧分发。
    for (const frame of frames) {
      // 原始帧先广播给调试监听器。
      this.emitRawFrame(sessionId, source, frame)

      // 只有“来源模式与当前会话模式一致”且“存在命令监听器”时，才继续分发给业务层。
      if (source !== state.mode || !sessionListeners?.size) {
        continue
      }

      // 把当前完整帧依次回调给该会话的所有监听器。
      for (const listener of sessionListeners) {
        listener(frame)
      }
    }
  }

  // 广播一帧完整原始帧给原始数据监听器。
  private emitRawFrame(sessionId: number, source: GuoxinConnectionMode, frame: string) {
    for (const listener of this.rawDataListeners) {
      listener(sessionId, source, frame)
    }
  }

  // 广播指定会话的最新快照。
  private emitStatus(sessionId: number) {
    const snapshot = this.getSnapshot(sessionId)
    for (const listener of this.statusListeners) {
      listener(snapshot)
    }
  }

  // 把一段原始数据并入缓冲，并尽可能切出完整协议帧。
  private handleNewRx(sessionId: number, source: GuoxinConnectionMode, data: string): string[] {
    // 先规范化成本项目统一使用的连续大写 HEX。
    const normalized = normalizeHex(String(data ?? ''))
    // 空数据直接返回空数组。
    if (!normalized) {
      return []
    }

    // 取出当前会话状态。
    const state = this.getSessionState(sessionId)
    // 把历史半包与当前数据拼在一起。
    let buffer = (state.rxBuffers[source] || '') + normalized
    // 收集本次切出来的完整帧。
    const frames: string[] = []

    while (true) {
      // 查找下一个帧头位置。
      const frameHeadIndex = buffer.indexOf(FRAME_HEAD)
      // 完全找不到帧头时，说明缓冲全是脏数据，直接清空。
      if (frameHeadIndex === -1) {
        buffer = ''
        break
      }

      // 帧头之前的垃圾数据全部丢弃。
      if (frameHeadIndex > 0) {
        buffer = buffer.slice(frameHeadIndex)
      }

      // 连最小头部都不够时，保留缓冲等待下一次继续拼接。
      if (buffer.length < FRAME_MIN_HEAD_CHARS) {
        break
      }

      // 长度字段位于第 10~13 个字符。
      const payloadLength = parseInt(buffer.slice(10, 14), 16)
      // 长度字段非法时，向后滑动 1 字节继续找下一处可能帧头。
      if (Number.isNaN(payloadLength)) {
        buffer = buffer.slice(2)
        continue
      }

      // 计算完整帧总长度。
      const frameLength = FRAME_FIXED_CHARS + payloadLength * 2
      // 当前缓冲还不够一帧时，等待更多数据到达。
      if (buffer.length < frameLength) {
        break
      }

      // 切出当前完整帧。
      frames.push(buffer.slice(0, frameLength))
      // 剩余内容继续参与下一轮切帧。
      buffer = buffer.slice(frameLength)
    }

    // 把未消费完的残留半包写回该模式缓冲。
    state.rxBuffers[source] = buffer
    // 返回本次提取到的完整帧数组。
    return frames
  }

  // 清空指定会话在某种连接模式下的半包缓冲。
  private resetRxBuffer(sessionId: number, mode: GuoxinConnectionMode) {
    this.getSessionState(sessionId).rxBuffers[mode] = ''
  }

  // 同时清空指定会话的串口/TCP 两套半包缓冲。
  private resetRxBuffers(sessionId: number) {
    this.resetRxBuffer(sessionId, 'serial')
    this.resetRxBuffer(sessionId, 'tcp')
  }

  // 获取某个会话的命令监听器集合；不存在时自动初始化。
  private getCommandListeners(sessionId: number) {
    let listeners = this.commandDataListeners.get(sessionId)
    if (!listeners) {
      listeners = new Set<GuoXinDataListener>()
      this.commandDataListeners.set(sessionId, listeners)
    }
    return listeners
  }

  // 获取某个会话状态；不存在时自动创建。
  private getSessionState(sessionId: number) {
    const targetSessionId = normalizeSessionId(sessionId)
    let state = this.sessionStates.get(targetSessionId)
    if (!state) {
      state = createSessionState()
      this.sessionStates.set(targetSessionId, state)
    }
    return state
  }

  // 只读取已存在的会话状态；若不存在则返回 null。
  private getSessionStateIfExists(sessionId: number) {
    return this.sessionStates.get(normalizeSessionId(sessionId)) ?? null
  }
}

// 整个项目只维护一个国芯设备单例。
export const guoxinSingleDevice = new GuoXinDevice()

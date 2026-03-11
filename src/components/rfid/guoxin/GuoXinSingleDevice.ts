import { normalizeHex } from './GuoXinCommon'

// 国芯设备当前支持的两种连接方式。
export type GuoxinConnectionMode = 'serial' | 'tcp'

// 当前内部只暴露一类业务数据事件。
type GuoXinEventName = 'GuoXin_Data'

// 完整协议帧监听器，供上层业务解析使用。
type GuoXinDataListener = (data: string) => void

// 原始完整帧监听器，保留数据来源，供日志或调试使用。
type GuoXinRawDataListener = (source: GuoxinConnectionMode, data: string) => void

// 设备状态监听器。
type GuoXinStatusListener = (state: GuoxinDeviceSnapshot) => void

export interface GuoxinDeviceSnapshot {
  // 当前实际使用的连接模式。
  mode: GuoxinConnectionMode
  // 当前通道是否已经连通。
  connected: boolean
  // 当前缓存的天线数量配置。
  antNum: number
  // 最近一次连接或通信错误。
  lastError: string | null
}

class GuoXinSingleDevice {
  // 避免重复注册 IPC 监听器。
  private initialized = false

  // 默认先按 TCP 模式初始化。
  private mode: GuoxinConnectionMode = 'tcp'

  // 当前连接状态。
  private connected = false

  // 缓存当前配置的天线数量，供 helper 在组装按天线下发的指令时使用。
  private antNumValue = 4

  // 缓存最近一次错误信息。
  private lastError: string | null = null

  // 串口和 TCP 都可能出现半包，因此每种传输方式各自维护接收缓冲区。
  private rxBuffers: Record<GuoxinConnectionMode, string> = {
    // 串口接收缓冲区。
    serial: '',
    // TCP 接收缓冲区。
    tcp: ''
  }

  // 业务层完整帧监听器集合。
  private commandDataListeners = new Set<GuoXinDataListener>()

  // 原始完整帧监听器集合。
  private rawDataListeners = new Set<GuoXinRawDataListener>()

  // 状态监听器集合。
  private statusListeners = new Set<GuoXinStatusListener>()

  /**
   * 获取当前缓存的天线数量。
   */
  get antNum() {
    // 暴露当前缓存的天线数量。
    return this.antNumValue
  }

  /**
   * 获取当前连接模式。
   */
  get currentMode() {
    // 暴露当前连接模式。
    return this.mode
  }

  /**
   * 获取当前是否已连接。
   */
  get isConnected() {
    // 暴露当前连接状态。
    return this.connected
  }

  /**
   * 更新设备侧缓存的天线数量。
   */
  setAntNum(antNum: number) {
    // 天线数量必须是正整数，否则后续组帧会出错。
    if (!Number.isInteger(antNum) || antNum <= 0) {
      throw new Error('天线数量必须是大于 0 的整数')
    }

    // 相同值不重复更新，也不重复广播状态。
    if (this.antNumValue === antNum) {
      return
    }

    // 写入新的天线数量缓存。
    this.antNumValue = antNum

    // 通知订阅方设备状态已变化。
    this.emitStatus()
  }

  /**
   * 生成一份当前设备状态快照。
   */
  getSnapshot(): GuoxinDeviceSnapshot {
    // 返回当前设备状态快照，避免外部直接碰内部字段。
    return {
      // 当前模式。
      mode: this.mode,
      // 当前连接状态。
      connected: this.connected,
      // 当前天线数量配置。
      antNum: this.antNumValue,
      // 最近一次错误。
      lastError: this.lastError
    }
  }

  /**
   * 订阅设备状态变化。
   */
  subscribeStatus(listener: GuoXinStatusListener) {
    // 确保底层 IPC 事件只注册一次。
    this.ensureInitialized()

    // 加入状态监听集合。
    this.statusListeners.add(listener)

    // 订阅后立刻推送一次当前状态，避免外部再主动取一次。
    listener(this.getSnapshot())

    // 返回取消订阅函数。
    return () => {
      // 从状态监听集合移除当前监听器。
      this.statusListeners.delete(listener)
    }
  }

  /**
   * 订阅完整原始帧数据，通常用于日志和调试。
   */
  subscribeRawData(listener: GuoXinRawDataListener) {
    // 确保底层 IPC 事件已完成注册。
    this.ensureInitialized()

    // 记录原始帧监听器。
    this.rawDataListeners.add(listener)

    // 返回取消订阅函数。
    return () => {
      // 从原始帧监听集合移除当前监听器。
      this.rawDataListeners.delete(listener)
    }
  }

  /**
   * 切换当前设备连接模式。
   */
  setMode(mode: GuoxinConnectionMode) {
    // 确保底层 IPC 事件已完成注册。
    this.ensureInitialized()

    // 切换当前模式。
    this.mode = mode

    // 模式切换后连接状态先回到未连接。
    this.connected = false

    // 清空旧模式残留错误。
    this.lastError = null

    // 模式切换时清空全部接收缓冲，避免串包。
    this.resetRxBuffers()

    // 广播最新状态。
    this.emitStatus()
  }

  /**
   * 连接串口设备。
   */
  async connectSerial(options: { path: string; baudRate: number }) {
    // 确保底层 IPC 事件已完成注册。
    this.ensureInitialized()

    // 进入串口模式。
    this.mode = 'serial'

    // 开始连接前清空旧错误。
    this.lastError = null

    // 开始连接前清空串口缓冲。
    this.resetRxBuffer('serial')

    // 先广播一次“串口连接中”前的状态。
    this.emitStatus()

    // 调用 preload 暴露的串口打开能力。
    await window.serial.open(options)
  }

  /**
   * 连接 TCP 设备。
   */
  async connectTcp(options: { host: string; port: number }) {
    // 确保底层 IPC 事件已完成注册。
    this.ensureInitialized()

    // 进入 TCP 模式。
    this.mode = 'tcp'

    // 开始连接前清空旧错误。
    this.lastError = null

    // 开始连接前清空 TCP 缓冲。
    this.resetRxBuffer('tcp')

    // 先广播一次“TCP 连接中”前的状态。
    this.emitStatus()

    // 调用 preload 暴露的 TCP 连接能力。
    await window.tcp.connect(options)
  }

  /**
   * 断开指定模式的连接，默认断开当前模式。
   */
  async disconnect(mode: GuoxinConnectionMode = this.mode) {
    // 确保底层 IPC 事件已完成注册。
    this.ensureInitialized()

    // 按指定模式断开对应通道。
    if (mode === 'serial') {
      // 断开串口。
      await window.serial.close()
    } else {
      // 断开 TCP。
      await window.tcp.disconnect()
    }

    // 断开后清空对应通道的接收缓冲。
    this.resetRxBuffer(mode)

    // 只有断开的正好是当前模式时，才需要更新当前连接状态。
    if (this.mode === mode) {
      // 标记为未连接。
      this.connected = false

      // 广播最新状态。
      this.emitStatus()
    }
  }

  /**
   * 按当前模式发送 HEX 指令。
   */
  sendMessageNew(hex: string) {
    // 确保底层 IPC 事件已完成注册。
    this.ensureInitialized()

    // 未连接时不允许下发指令。
    if (!this.connected) {
      throw new Error('国芯 RFID 设备未连接')
    }

    // 发送前统一把 HEX 规范化。
    const payload = normalizeHex(hex)

    // 串口模式走串口写入。
    if (this.mode === 'serial') {
      // 使用 void 忽略 Promise 返回值，与现有调用风格保持一致。
      void window.serial.write(payload)
      return
    }

    // TCP 模式走 TCP 写入。
    void window.tcp.write(payload)
  }

  /**
   * 注册业务层完整帧监听器。
   */
  on(eventName: GuoXinEventName, listener: GuoXinDataListener) {
    // 确保底层 IPC 事件已完成注册。
    this.ensureInitialized()

    // 当前仅支持这一类业务事件，其它值直接忽略。
    if (eventName !== 'GuoXin_Data') return

    // 注册业务完整帧监听器。
    this.commandDataListeners.add(listener)
  }

  /**
   * 取消注册业务层完整帧监听器。
   */
  off(eventName: GuoXinEventName, listener?: GuoXinDataListener) {
    // 当前仅支持这一类业务事件，其它值直接忽略。
    if (eventName !== 'GuoXin_Data') return

    // 传了具体监听器时，只移除这一项。
    if (listener) {
      // 删除指定业务监听器。
      this.commandDataListeners.delete(listener)
      return
    }

    // 未传监听器时，清空全部业务监听器。
    this.commandDataListeners.clear()
  }

  /**
   * 延迟注册底层 IPC 事件，确保只初始化一次。
   */
  private ensureInitialized() {
    // 已初始化过就不重复注册 IPC 事件。
    if (this.initialized) return

    // 标记初始化完成。
    this.initialized = true

    // 串口打开成功事件。
    window.ipcRenderer.on('serial:open', () => {
      // 只有当前模式确实是串口时才处理。
      if (this.mode !== 'serial') return

      // 更新连接状态为已连接。
      this.connected = true

      // 清空旧错误。
      this.lastError = null

      // 广播最新状态。
      this.emitStatus()
    })

    // 串口关闭事件。
    window.ipcRenderer.on('serial:close', () => {
      // 只有当前模式确实是串口时才处理。
      if (this.mode !== 'serial') return

      // 更新连接状态为未连接。
      this.connected = false

      // 清空串口接收缓冲，避免残包影响下次连接。
      this.resetRxBuffer('serial')

      // 广播最新状态。
      this.emitStatus()
    })

    // 串口错误事件。
    window.ipcRenderer.on('serial:error', (_, message: string) => {
      // 只有当前模式确实是串口时才处理。
      if (this.mode !== 'serial') return

      // 发生错误后视为未连接。
      this.connected = false

      // 记录错误消息。
      this.lastError = message

      // 清空串口接收缓冲，避免残包污染后续通信。
      this.resetRxBuffer('serial')

      // 广播最新状态。
      this.emitStatus()
    })

    // 串口收到数据事件。
    window.ipcRenderer.on('serial:data', (_, data: string) => {
      // 把串口数据交给统一接收入口处理。
      this.emitData('serial', data)
    })

    // TCP 连接成功事件。
    window.ipcRenderer.on('tcp:connect', () => {
      // 只有当前模式确实是 TCP 时才处理。
      if (this.mode !== 'tcp') return

      // 更新连接状态为已连接。
      this.connected = true

      // 清空旧错误。
      this.lastError = null

      // 广播最新状态。
      this.emitStatus()
    })

    // TCP 关闭事件。
    window.ipcRenderer.on('tcp:close', () => {
      // 只有当前模式确实是 TCP 时才处理。
      if (this.mode !== 'tcp') return

      // 更新连接状态为未连接。
      this.connected = false

      // 清空 TCP 接收缓冲，避免残包影响下次连接。
      this.resetRxBuffer('tcp')

      // 广播最新状态。
      this.emitStatus()
    })

    // TCP 错误事件。
    window.ipcRenderer.on('tcp:error', (_, message: string) => {
      // 只有当前模式确实是 TCP 时才处理。
      if (this.mode !== 'tcp') return

      // 发生错误后视为未连接。
      this.connected = false

      // 记录错误消息。
      this.lastError = message

      // 清空 TCP 接收缓冲，避免残包污染后续通信。
      this.resetRxBuffer('tcp')

      // 广播最新状态。
      this.emitStatus()
    })

    // TCP 收到数据事件。
    window.ipcRenderer.on('tcp:data', (_, data: string) => {
      // 把 TCP 数据交给统一接收入口处理。
      this.emitData('tcp', data)
    })
  }

  /**
   * 接收一段原始数据，拆成完整帧后再分发。
   */
  private emitData(source: GuoxinConnectionMode, data: string) {
    // 先把原始数据拼进缓冲，并提取出所有完整帧。
    const frames = this.handleNewRx(source, data)

    // 当前 chunk 里还拼不出完整帧时直接返回，继续等下一段数据。
    if (!frames.length) return

    // 逐帧往下分发，保证上层只看到完整协议帧。
    frames.forEach((frame) => {
      // 原始帧监听器不区分当前模式，主要用于日志和调试。
      this.rawDataListeners.forEach((listener) => {
        // 把来源和完整帧一起交给订阅方。
        listener(source, frame)
      })

      // 只有来源与当前模式一致时，才分发给业务层监听器。
      if (source !== this.mode) return

      // 把完整帧交给业务解析监听器。
      this.commandDataListeners.forEach((listener) => {
        listener(frame)
      })
    })
  }

  /**
   * 向所有状态订阅方广播当前状态。
   */
  private emitStatus() {
    // 先生成一次最新状态快照。
    const snapshot = this.getSnapshot()

    // 把同一份快照广播给所有状态监听器。
    this.statusListeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  /**
   * 处理新收到的原始 HEX 数据，完成半包拼接和粘包拆分。
   */
  private handleNewRx(source: GuoxinConnectionMode, data: string): string[] {
    // 先把输入转成连续的大写 HEX，方便统一处理。
    const normalized = normalizeHex(String(data ?? ''))

    // 空数据直接返回空结果。
    if (!normalized) {
      return []
    }

    // 先在接收层完成组帧，再把完整帧交给上层业务解析。
    let buffer = (this.rxBuffers[source] || '') + normalized

    // 收集这次输入里能够拼出来的所有完整帧。
    const frames: string[] = []

    while (true) {
      // 从当前缓冲区里寻找帧头 5A。
      const startIndex = buffer.indexOf('5A')

      // 连帧头都找不到时，说明当前缓冲没有可用数据，直接丢弃。
      if (startIndex === -1) {
        buffer = ''
        break
      }

      // 帧头前如果有脏数据，直接裁掉，只保留从帧头开始的内容。
      if (startIndex > 0) {
        buffer = buffer.slice(startIndex)
      }

      // 协议最短长度为帧头 1 字节 + 控制字 4 字节 + 长度 2 字节。
      if (buffer.length < 14) {
        break
      }

      // 长度字段位于控制字后面，占 2 字节。
      const lengthHex = buffer.slice(10, 14)

      // 解析 payload 长度，单位是字节。
      const payloadLength = parseInt(lengthHex, 16)

      // 长度字段异常时，向后跳过 1 个字节继续重新找帧头。
      if (Number.isNaN(payloadLength)) {
        buffer = buffer.slice(2)
        continue
      }

      // 整帧长度 = 帧头 1 字节 + 控制字 4 字节 + 长度 2 字节 + payload + CRC 2 字节。
      const frameLength = 18 + payloadLength * 2

      // 当前数据还不够一整帧时，保留缓冲，等待后续数据补齐。
      if (buffer.length < frameLength) {
        break
      }

      // 切出一帧完整数据加入结果。
      frames.push(buffer.slice(0, frameLength))

      // 把已经消费掉的完整帧从缓冲中移除，继续尝试拆下一帧。
      buffer = buffer.slice(frameLength)
    }

    // 回写剩余半包，供下一次数据到达时继续拼接。
    this.rxBuffers[source] = buffer

    // 返回本次成功提取出的完整帧列表。
    return frames
  }

  /**
   * 清空指定通道的接收缓冲。
   */
  private resetRxBuffer(mode: GuoxinConnectionMode) {
    // 清空指定通道的接收缓冲。
    this.rxBuffers[mode] = ''
  }

  /**
   * 清空全部通道的接收缓冲。
   */
  private resetRxBuffers() {
    // 清空串口接收缓冲。
    this.resetRxBuffer('serial')

    // 清空 TCP 接收缓冲。
    this.resetRxBuffer('tcp')
  }
}

// 导出单例，整个页面共用同一份设备状态和事件通道。
export const guoxinSingleDevice = new GuoXinSingleDevice()

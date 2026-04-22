// 引入国芯协议里各种状态码转中文描述的方法，以及帧解析工具。
import {
  extractPowerValues,
  getEPCBasebandParamConfigDesc,
  getLockResultDesc,
  getPowerConfigDesc,
  getReadDesc,
  getStopReadDesc,
  getWriteResultDesc,
  IRFIDTagReadMessage,
  parseEPCMessage,
  parseFrame
} from './GuoXinCommon'

// 引入设备单例，用来按会话挂载/移除监听器。
import { guoxinSingleDevice } from './GuoXinDevice'

// 统一约束“发送动作”函数签名。
type SendAction = () => void

// 单次响应等待器的参数集合。
interface SingleResponseOptions<T> {
  // 期望命中的消息 ID。
  mid: string
  // 超时时间。
  timeoutMs: number
  // 超时提示文案。
  timeoutMessage: string
  // 命中后如何把 payload 解析成业务结果。
  parsePayload: (payload: string, rawData: string) => T
  // 真正发送命令的动作，可选。
  send?: SendAction
  // 指定监听的会话 ID，可选。
  sessionId?: number
}

// 国芯协议里 `00` 一般代表执行成功。
const SUCCESS_PAYLOAD = '00'

// 如果外部没显式传会话，就回退到当前激活会话。
function resolveSessionId(sessionId?: number) {
  return sessionId ?? guoxinSingleDevice.currentSessionId
}

// 把未知异常统一收敛成 Error 对象，避免后续到处判断类型。
function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

// 要求 payload 必须是成功码，否则抛出协议描述过的错误文案。
function ensureSuccessPayload(payload: string, getDesc: (payload: string) => string) {
  // 成功时直接返回，不打断调用链。
  if (payload === SUCCESS_PAYLOAD) {
    return
  }

  // 失败时根据 payload 转成更具体的错误消息。
  throw new Error(getDesc(payload))
}

// 从通用帧对象里安全提取消息 ID。
function getMid(frame: Record<string, unknown>) {
  return String(frame.mid ?? '')
}

// 从通用帧对象里安全提取 payload。
function getPayload(frame: Record<string, unknown>) {
  return String(frame.payload ?? '')
}

// 封装“等某个 mid 的单次响应”这类最常见的命令交互模式。
function waitForSingleResponse<T>(options: SingleResponseOptions<T>): Promise<T> {
  // 先把调用方传入的参数拆开，便于后面使用。
  const { mid, timeoutMs, timeoutMessage, parsePayload, send, sessionId } = options
  // 解析出本次应该监听的目标会话。
  const targetSessionId = resolveSessionId(sessionId)

  // 返回一个 Promise，在收到目标响应、超时或发送失败时结束。
  return new Promise<T>((resolve, reject) => {
    // 监听器会收到当前会话切出来的每一帧完整 HEX。
    const handler = (data: string) => {
      try {
        // 先把完整帧解析成结构化对象。
        const frame = parseFrame(data)
        // 不是当前要等的消息 ID，就忽略，继续等下一帧。
        if (getMid(frame) !== mid) {
          return
        }

        // 命中目标响应后，先解除监听和定时器。
        cleanup()
        // 再把 payload 解析成业务结果并完成 Promise。
        resolve(parsePayload(getPayload(frame), data))
      } catch (error) {
        // 任意解析异常都视为本次等待失败。
        cleanup()
        reject(toError(error))
      }
    }

    // 启动超时定时器，避免设备一直不回导致 Promise 悬挂。
    const timer = setTimeout(() => {
      // 超时时也要清理现场。
      cleanup()
      // 保留一条调试日志，便于定位设备未响应问题。
      console.warn(timeoutMessage)
      // 以异常结束 Promise。
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    // 把监听器和定时器的释放动作收敛到一个函数里。
    const cleanup = () => {
      // 停掉超时计时。
      clearTimeout(timer)
      // 从目标会话移除当前监听器。
      guoxinSingleDevice.off(handler, targetSessionId)
    }

    // 先注册监听，再发送指令，避免设备回包太快被漏掉。
    guoxinSingleDevice.on(handler, targetSessionId)

    // 如果调用方只是想单纯挂等待器，不要求立即发送，则到这里直接返回。
    if (!send) {
      return
    }

    try {
      // 真正把命令发给设备。
      send()
    } catch (error) {
      // 发送动作本身抛错时，同样要清理监听器和定时器。
      cleanup()
      // 把异常透传给调用方。
      reject(toError(error))
    }
  })
}

// 等待“配置功率”的单次响应。
export function configPowerParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    // 配置功率响应的 MID。
    mid: '0x01',
    // 配置命令默认等待 3 秒。
    timeoutMs: 3000,
    // 超时文案。
    timeoutMessage: 'Timeout waiting for configPowerParseFrame',
    // 发送动作。
    send,
    // 目标会话。
    sessionId,
    // 只要不是成功码就抛错。
    parsePayload: (payload) => ensureSuccessPayload(payload, getPowerConfigDesc)
  })
}

// 等待“停止盘存”的单次响应。
export function stopReadEPCParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    // 停止盘存响应的 MID。
    mid: '0xFF',
    // 超时时间 3 秒。
    timeoutMs: 3000,
    // 超时文案。
    timeoutMessage: 'Timeout waiting for stopReadEPCParseFrame',
    // 发送动作。
    send,
    // 目标会话。
    sessionId,
    // 失败时按协议状态码抛错。
    parsePayload: (payload) => ensureSuccessPayload(payload, getStopReadDesc)
  })
}

// 等待“读取所有天线功率”的单次响应，并把 payload 转成功率数组。
export function readAllAntOutputPowerParseFrame(send?: SendAction, sessionId?: number) {
  return waitForSingleResponse<number[]>({
    // 读功率响应的 MID。
    mid: '0x02',
    // 超时时间 3 秒。
    timeoutMs: 3000,
    // 超时文案。
    timeoutMessage: 'Timeout waiting for readAllAntOutputPowerParseFrame',
    // 发送动作。
    send,
    // 目标会话。
    sessionId,
    // 把 payload 里的功率值拆成数组。
    parsePayload: (payload) => extractPowerValues(payload)
  })
}

// 处理“单次盘存 EPC”的响应流。
export function readEPCParseFrame(
  // 每读到一张标签就回调一次。
  onData: (data: IRFIDTagReadMessage) => void,
  // 盘存结束、超时或失败时统一回调结束原因。
  onDone: (reason: string) => void,
  // 发送动作，可选。
  send?: SendAction,
  // 目标会话，可选。
  sessionId?: number
) {
  // 解析出本次盘存要监听的会话。
  const targetSessionId = resolveSessionId(sessionId)

  // 单次盘存期间会持续收到多帧数据，所以这里不是 Promise，而是手动管理监听器生命周期。
  const handler = (rawData: string) => {
    // 先声明帧变量，便于后面在 try/catch 外继续使用。
    let frame: Record<string, unknown>

    try {
      // 尝试把原始帧解析成结构化对象。
      frame = parseFrame(rawData)
    } catch (error) {
      // 帧格式错误时，直接结束当前盘存流程。
      cleanup()
      // 把错误原因通知给上层。
      onDone(toError(error).message)
      return
    }

    // 取出当前帧的消息 ID。
    const mid = getMid(frame)
    // 取出当前帧的 payload。
    const payload = getPayload(frame)

    // `0x00` 表示盘存过程中回推的标签数据帧。
    if (mid === '0x00') {
      // 解析标签 payload。
      const tagData = parseEPCMessage(payload)
      // 能解析出标签对象就回调给业务层。
      if (tagData) {
        onData(tagData)
      }
      // 标签数据帧不代表结束，所以继续监听。
      return
    }

    // 不是结束帧就继续等。
    if (mid !== '0x01') {
      return
    }

    // 收到结束帧后，先清理监听器。
    cleanup()
    // 再把结束原因回给业务层。
    onDone(getReadDesc(payload) || '读卡结束')
  }

  // 单次盘存也要设置总超时，避免设备异常时永远不返回。
  const timer = setTimeout(() => {
    // 超时先清理监听器。
    cleanup()
    // 组装超时文案。
    const timeoutMessage = 'Timeout waiting for readEPCParseFrame'
    // 输出调试日志。
    console.warn(timeoutMessage)
    // 把超时结果回给业务层。
    onDone(timeoutMessage)
  }, 5000)

  // 统一封装清理逻辑。
  const cleanup = () => {
    // 清掉超时定时器。
    clearTimeout(timer)
    // 从当前会话移除监听器。
    guoxinSingleDevice.off(handler, targetSessionId)
  }

  // 先监听，再发命令。
  guoxinSingleDevice.on(handler, targetSessionId)

  // 如果这里只想单纯开始监听，不要求立即发送，则直接结束函数。
  if (!send) {
    return
  }

  try {
    // 执行真正的发送动作。
    send()
  } catch (error) {
    // 发送失败时也要清理监听器。
    cleanup()
    // 把异常继续抛给调用方。
    throw toError(error)
  }
}

// 处理“连续盘存 EPC”的响应流。
export function readEPCContinuousParseFrame(
  // 每收到一条标签数据都回调一次；解析失败时不会中断整个连续盘存。
  callback: (data: IRFIDTagReadMessage | null) => void,
  // 发送动作，可选。
  send?: SendAction,
  // 目标会话，可选。
  sessionId?: number
) {
  // 解析出本次连续盘存要监听的会话。
  const targetSessionId = resolveSessionId(sessionId)

  // 连续盘存监听器。
  const handler = (rawData: string) => {
    try {
      // 先解析协议帧。
      const frame = parseFrame(rawData)
      // 连续盘存只关心标签数据帧。
      if (getMid(frame) !== '0x00') {
        return
      }

      // 命中标签数据帧时，把 payload 解析成标签对象回调出去。
      callback(parseEPCMessage(getPayload(frame)))
    } catch (error) {
      // 连续盘存不因为单帧异常就结束，只输出警告日志。
      console.warn('readEPCContinuousParseFrame parse error:', toError(error).message)
    }
  }

  // 注册监听器。
  guoxinSingleDevice.on(handler, targetSessionId)

  // 如果要求立即发送连续盘存指令，就在监听就位后执行。
  if (send) {
    try {
      // 发送连续盘存命令。
      send()
    } catch (error) {
      // 发送失败时移除监听器，避免遗留脏监听。
      guoxinSingleDevice.off(handler, targetSessionId)
      // 把异常继续向上抛。
      throw toError(error)
    }
  }

  // 返回一个取消函数，供外层主动停止监听。
  return () => {
    // 把当前监听器从目标会话卸载掉。
    guoxinSingleDevice.off(handler, targetSessionId)
  }
}

// 解析“锁标签”的单次响应。
export function lockRfidParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    // 锁标签响应的 MID。
    mid: '0x12',
    // 超时时间 3 秒。
    timeoutMs: 3000,
    // 超时文案。
    timeoutMessage: 'Timeout waiting for lockRfidParseFrame',
    // 发送动作。
    send,
    // 会话 ID。
    sessionId,
    // 命中响应后先打日志，再校验是否成功。
    parsePayload: (payload, rawData) => {
      // 保留原始帧，便于联调。
      console.log('lockRfidParseFrame:', rawData)
      // 校验响应结果。
      ensureSuccessPayload(payload, getLockResultDesc)
    }
  })
}

// 解析“写 EPC”的单次响应。
export function writeEPCParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    // 写 EPC 响应的 MID。
    mid: '0x11',
    // 超时时间 3 秒。
    timeoutMs: 3000,
    // 超时文案。
    timeoutMessage: 'Timeout waiting for writeEPCParseFrame',
    // 发送动作。
    send,
    // 会话 ID。
    sessionId,
    // 命中响应后先记录原始帧，再校验写入结果。
    parsePayload: (payload, rawData) => {
      // 输出原始响应。
      console.log('writeEPCParseFrame:', rawData)
      // 校验协议返回码。
      ensureSuccessPayload(payload, getWriteResultDesc)
    }
  })
}

// 解析“更新 EPC 密码”的单次响应。
export function updateEPCPasswordParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    // 更新密码复用写 EPC 的 MID。
    mid: '0x11',
    // 超时时间 3 秒。
    timeoutMs: 3000,
    // 超时文案。
    timeoutMessage: 'Timeout waiting for updateEPCPasswordParseFrame',
    // 发送动作。
    send,
    // 会话 ID。
    sessionId,
    // 命中响应后记录帧，并按写入结果解释错误。
    parsePayload: (payload, rawData) => {
      // 输出原始响应。
      console.log('updateEPCPasswordParseFrame:', rawData)
      // 校验协议返回码。
      ensureSuccessPayload(payload, getWriteResultDesc)
    }
  })
}

// 解析“配置 EPC 基带参数”的单次响应。
export function configEPCBasebandParamParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    // 基带参数配置响应的 MID。
    mid: '0x0B',
    // 超时时间 3 秒。
    timeoutMs: 3000,
    // 超时文案。
    timeoutMessage: 'Timeout waiting for configEPCBasebandParamParseFrame',
    // 发送动作。
    send,
    // 会话 ID。
    sessionId,
    // 命中响应后记录帧，并按基带参数配置结果校验。
    parsePayload: (payload, rawData) => {
      // 输出原始响应。
      console.log('configEPCBasebandParamParseFrame:', rawData)
      // 校验协议返回码。
      ensureSuccessPayload(payload, getEPCBasebandParamConfigDesc)
    }
  })
}

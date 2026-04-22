// 引入国芯设备单例，负责按会话发送串口/TCP 数据。
import { guoxinSingleDevice } from './GuoXinDevice'
// 引入国芯协议里用到的基础工具函数和类型。
import {
  antsToHexMask,
  calcMatchBitLength,
  calculateDataLength,
  IRFIDTagReadMessage,
  normalizeHex,
  ControlWordParams,
  generateControlWord,
  crc16Ccitt,
  toHex
} from './GuoXinCommon'
// 引入响应解析层，每个 helper 都对应一个具体的响应等待器。
import {
  configPowerParseFrame,
  configEPCBasebandParamParseFrame,
  lockRfidParseFrame,
  readAllAntOutputPowerParseFrame,
  readEPCContinuousParseFrame,
  readEPCParseFrame,
  stopReadEPCParseFrame,
  updateEPCPasswordParseFrame,
  writeEPCParseFrame
} from './GuoXinParseFrame'

// 控制字里除了消息 ID 之外，其它字段目前在本项目里都是固定值。
const baseControlWordParams: Omit<ControlWordParams, 'messageId'> = {
  // 协议类型固定为 0。
  protocolType: 0,
  // 协议版本固定为 1。
  protocolVersion: 1,
  // 当前场景不走 RS485 地址位。
  rs485Flag: 0,
  // 当前都是主机发起命令，不是设备主动上传。
  uploadFlag: 0,
  // 当前使用的消息分类固定为 2。
  messageCategory: 2
}

// 本文件会用到的几个消息 ID 常量。
const MESSAGE_ID = {
  // 配置天线功率。
  CONFIG_POWER: 0x01,
  // 读取所有天线输出功率。
  READ_ALL_POWER: 0x02,
  // 配置 EPC 基带参数。
  CONFIG_BASEBAND: 0x0b,
  // 盘存 EPC。
  READ_EPC: 0x10,
  // 写 EPC。
  WRITE_EPC: 0x11,
  // 锁标签。
  LOCK_RFID: 0x12,
  // 停止盘存。
  STOP_READ_EPC: 0xff
} as const

// 盘存指令里固定跟随的配置段。
const INVENTORY_CONFIG = '02 00 06'

// 首次写卡流程里，每一步锁区操作的描述。
type FirstWriteLockStep = {
  // 本次要锁定的数据区编号。
  lockGoal: number
  // 失败时的错误提示。
  msg: string
  // 成功时的进度提示。
  successMsg: string
}

// 首写 EPC 场景需要的完整参数集合。
export interface WriteEPCFirstTimeOptions {
  // 参与操作的天线列表。
  ants: number[]
  // 新 EPC 数据。
  newData: string
  // 用于选标的 TID。
  tid: string
  // 新访问密码。
  accessPassword: string
  // 旧访问密码。
  oldAccessPassword: string
  // 销毁密码。
  killPassword: string
  // 指定会话，可选。
  sessionId?: number
  // 进度回调，可选。
  onProgress?: (message: string) => void
}

// 首次写卡后还要依次锁定几个关键区域。
const FIRST_WRITE_LOCK_STEPS: FirstWriteLockStep[] = [
  // 锁灭活密码区。
  { lockGoal: 0, msg: '锁灭活密码区失败', successMsg: '锁灭活密码区成功' },
  // 锁访问密码区。
  { lockGoal: 1, msg: '锁认证密码区失败', successMsg: '锁认证密码区成功' },
  // 锁 EPC 区。
  { lockGoal: 2, msg: '锁EPC区失败', successMsg: '锁EPC区成功' },
  // 锁用户数据区。
  { lockGoal: 4, msg: '锁用户数据区失败', successMsg: '锁用户数据区成功' }
]

// 生成带固定控制字参数的消息控制字 HEX。
const buildControlWord = (messageId: number) =>
  generateControlWord({
    // 复用统一的固定字段。
    ...baseControlWordParams,
    // 仅替换本次命令的消息 ID。
    messageId
  }).hex

// 对底层发送动作做一层包装，保持 helper 层调用统一。
const sendFrame = (frame: string, sessionId?: number) => {
  // 交给设备单例按会话发送。
  guoxinSingleDevice.sendMessageNew(frame, sessionId)
}

// 组装一条完整的国芯协议帧。
function buildFrame(messageId: number, payload = '') {
  // 先构造控制字。
  const controlWord = buildControlWord(messageId)
  // payload 统一规范成连续大写 HEX。
  const data = normalizeHex(payload)
  // 有数据时按字节数计算长度；无数据时长度字段为 0000。
  const length = data ? calculateDataLength(data, 4).hexLength : '0000'
  // CRC 的输入是控制字 + 长度 + 数据。
  const crcSource = data ? `${controlWord}${length}${data}` : `${controlWord}${length}`
  // 计算 CRC16。
  const crc = crc16Ccitt(crcSource)

  // 拼出完整帧：帧头 + 控制字 + 长度 + 数据 + CRC。
  return `5A${controlWord}${length}${data}${crc}`
}

// 构造盘存指令的 payload。
function buildInventoryPayload(ants: number[], continuous: boolean) {
  // 天线数组转换成位掩码。
  const antMask = antsToHexMask(ants)
  // 连续盘存为 01，单次盘存为 00。
  const continuousFlag = continuous ? '01' : '00'
  // 最终按协议字段顺序拼接。
  return normalizeHex(`${antMask} ${continuousFlag} ${INVENTORY_CONFIG}`)
}

// 构造基于 TID 的选标块。
function buildTidSelectBlock(tid: string) {
  // 先计算 TID 在协议里要求的“位长度”字段。
  const tidLength = calcMatchBitLength(tid).hexField
  // `02` 表示匹配 TID 区，偏移为 0000，后面跟位长度和匹配值。
  const data = normalizeHex(`02 0000 ${tidLength} ${tid}`)

  return {
    // 选标数据本体。
    data,
    // 选标数据字节长度字段。
    length: calculateDataLength(data, 4).hexLength
  }
}

// 校验单个天线功率是否合法。
function validatePower(power: number, antenna: number) {
  // 国芯协议支持 0~33 的整数功率值。
  if (!Number.isInteger(power) || power < 0 || power > 33) {
    throw new Error(`天线 ${antenna} 功率必须是 0~33 的整数`)
  }
}

// 把各天线功率数组编码成协议要求的 payload。
function buildPowerPayload(powerLevels: number[], antNum: number) {
  // 如果给的功率值数量不够，就直接报错。
  if (powerLevels.length < antNum) {
    throw new Error(`请提供 ${antNum} 个天线功率值`)
  }

  // 按“天线号 + 功率值”两字节一组依次拼接。
  return Array.from({ length: antNum }, (_, index) => {
    // 当前逻辑天线号是从 1 开始的。
    const antenna = index + 1
    // 取出该天线对应的功率值。
    const power = powerLevels[index]
    // 发送前先做一次范围校验。
    validatePower(power, antenna)
    // 按单字节十六进制编码天线号和功率。
    return `${toHex(antenna)}${toHex(power)}`
  }).join('')
}

// 单次盘存 EPC。
export function readEPC(
  // 参与盘存的天线列表。
  ants: number[],
  // 每次读到标签时的回调。
  callback: (data: IRFIDTagReadMessage | null) => void,
  // 目标会话，可选。
  sessionId?: number
) {
  // 先构造单次盘存 payload。
  const payload = buildInventoryPayload(ants, false)
  // 再拼出完整的协议帧。
  const frame = buildFrame(MESSAGE_ID.READ_EPC, payload)

  // readEPCParseFrame 使用回调模式，这里再包一层 Promise，统一返回结束原因。
  return new Promise<string | null>((resolve, reject) => {
    try {
      // 交给解析层监听响应。
      readEPCParseFrame(
        // 每读到一张标签就回调给上层。
        (tagData) => {
          callback(tagData)
        },
        // 读卡结束时把原因 resolve 出去。
        (reason) => {
          resolve(reason)
        },
        // 真正发送命令。
        () => {
          sendFrame(frame, sessionId)
        },
        // 目标会话。
        sessionId
      )
    } catch (error) {
      // 同步发送阶段抛错时直接 reject。
      reject(error)
    }
  })
}

// 连续盘存 EPC。
export function readEPCContinuous(
  // 连续回推标签数据的回调。
  ants: number[],
  callback: (data: IRFIDTagReadMessage | null) => void,
  // 目标会话，可选。
  sessionId?: number
) {
  // 构造连续盘存 payload。
  const payload = buildInventoryPayload(ants, true)
  // 拼完整帧。
  const frame = buildFrame(MESSAGE_ID.READ_EPC, payload)

  // 直接返回解析层提供的取消监听函数。
  return readEPCContinuousParseFrame(
    // 每次收到标签数据都透传给上层。
    (tagData) => {
      callback(tagData)
    },
    // 真正发送连续盘存命令。
    () => {
      sendFrame(frame, sessionId)
    },
    // 目标会话。
    sessionId
  )
}

// 停止正在进行的盘存。
export async function stopReadEPC(sessionId?: number): Promise<void> {
  // 停止盘存没有 payload，只需要消息 ID。
  const frame = buildFrame(MESSAGE_ID.STOP_READ_EPC)
  // 发送并等待停止响应。
  return stopReadEPCParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

/**
 * 设置天线功率。
 * @param powerLevels 每个天线的功率数组，索引 0 对应天线 1
 */
export async function configPower(powerLevels: number[], sessionId?: number): Promise<void> {
  // 从设备状态里拿到当前会话实际配置的天线数量。
  const antNum = guoxinSingleDevice.getAntNum(sessionId)
  // 把功率数组编码成 payload。
  const payload = buildPowerPayload(powerLevels, antNum)
  // 拼出完整帧。
  const frame = buildFrame(MESSAGE_ID.CONFIG_POWER, payload)

  // 发送并等待配置响应。
  return configPowerParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// 读取所有天线当前输出功率。
export async function readAllAntOutputPower(sessionId?: number): Promise<number[]> {
  // 该命令不需要 payload。
  const frame = buildFrame(MESSAGE_ID.READ_ALL_POWER)
  // 发送并等待返回功率数组。
  return readAllAntOutputPowerParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// ants 天线数组
// lockGoal: 0， 灭活密码区 1， 访问密码区 2，EPC 区  3，TID 区 4，用户数据区
// lockType: 0， 解锁 1， 锁定 2， 永久解锁 3， 永久锁定
// tid: 匹配数据内容 tid
// accessPassword: 标签访问密码
export async function lockRfid(
  // 参与操作的天线列表。
  ants: number[],
  // 锁定目标区。
  lockGoal: number,
  // 锁定类型。
  lockType: number,
  // 用于选标的 TID。
  tid: string,
  // 标签访问密码。
  accessPassword: string,
  // 目标会话，可选。
  sessionId?: number
): Promise<void> {
  // 先编码天线掩码。
  const antMask = antsToHexMask(ants)
  // 锁区编号转单字节 HEX。
  const lockGoalHex = toHex(lockGoal)
  // 锁类型转单字节 HEX。
  const lockTypeHex = toHex(lockType)
  // 构造 TID 选标块。
  const select = buildTidSelectBlock(tid)

  // 按协议字段顺序构造 payload。
  const payload = normalizeHex(
    `${antMask} ${lockGoalHex} ${lockTypeHex} 01 ${select.length} ${select.data} 02 ${accessPassword}`
  )
  // 拼成完整帧。
  const frame = buildFrame(MESSAGE_ID.LOCK_RFID, payload)

  // 打印联调日志。
  console.log('lockRfid:', frame)

  // 发送并等待锁定结果。
  return lockRfidParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// newData: 待写入数据
// tid: 匹配数据内容 tid
// accessPassword: 密码
export async function writeEPC(
  // 参与操作的天线列表。
  ants: number[],
  // 新 EPC 数据。
  newData: string,
  // 用于选标的 TID。
  tid: string,
  // 标签访问密码。
  accessPassword: string,
  // 目标会话，可选。
  sessionId?: number
): Promise<void> {
  // 天线数组转位掩码。
  const antMask = antsToHexMask(ants)
  // EPC 区写入起始字地址固定为 0x3400，后面跟待写入 EPC。
  const writeData = normalizeHex(`3400${newData}`)
  // 计算写入数据长度字段。
  const writeDataLength = calculateDataLength(writeData, 4).hexLength
  // 构造选标块。
  const select = buildTidSelectBlock(tid)

  // 按协议顺序构造 payload。
  const payload = normalizeHex(
    `${antMask} 01 0001 ${writeDataLength} ${writeData} 01 ${select.length} ${select.data} 02 ${accessPassword}`
  )
  // 拼成完整帧。
  const frame = buildFrame(MESSAGE_ID.WRITE_EPC, payload)

  // 打印联调日志。
  console.log('writeEPC:', frame)

  // 发送并等待写入结果。
  return writeEPCParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// accessPassword: 新认证密码
// killPassword: 销毁密码
// oldAccessPassword: 旧密码
// tid: 匹配数据内容 tid
export async function updateEPCPassword(
  // 参与操作的天线列表。
  ants: number[],
  // 新访问密码。
  accessPassword: string,
  // 销毁密码。
  killPassword: string,
  // 旧访问密码。
  oldAccessPassword: string,
  // 用于选标的 TID。
  tid: string,
  // 目标会话，可选。
  sessionId?: number
): Promise<void> {
  // 天线数组转位掩码。
  const antMask = antsToHexMask(ants)
  // 保留区写入数据格式为“销毁密码 + 访问密码”。
  const reservedData = normalizeHex(`${killPassword}${accessPassword}`)
  // 计算保留区写入长度。
  const reservedLength = calculateDataLength(reservedData, 4).hexLength
  // 构造选标块。
  const select = buildTidSelectBlock(tid)

  // 按协议顺序构造 payload。
  const payload = normalizeHex(
    `${antMask} 00 0000 ${reservedLength} ${reservedData} 01 ${select.length} ${select.data} 02 ${oldAccessPassword}`
  )
  // 拼成完整帧。
  const frame = buildFrame(MESSAGE_ID.WRITE_EPC, payload)

  // 打印联调日志。
  console.log('updateEPCPassword:', frame)

  // 发送并等待写密码结果。
  return updateEPCPasswordParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// 首次写卡：先改密码，再锁关键区，最后写 EPC。
export async function writeEPCFirstTime(options: WriteEPCFirstTimeOptions) {
  // 把调用参数拆开，后续每一步都要用到。
  const {
    ants,
    newData,
    tid,
    accessPassword,
    oldAccessPassword,
    killPassword,
    sessionId,
    onProgress
  } = options

  // 第一步：先把访问密码和销毁密码写进去。
  await updateEPCPassword(ants, accessPassword, killPassword, oldAccessPassword, tid, sessionId)
  // 通知页面密码写入成功。
  onProgress?.('修改密码成功')

  // 第二步：依次锁定几个关键区域。
  const lockType = 1
  for (const step of FIRST_WRITE_LOCK_STEPS) {
    // 执行当前锁区操作。
    await lockRfid(ants, step.lockGoal, lockType, tid, accessPassword, sessionId)
    // 向上汇报当前步骤完成。
    onProgress?.(step.successMsg)
  }

  // 第三步：真正写入新的 EPC 数据。
  await writeEPC(ants, newData, tid, accessPassword, sessionId)
  // 通知页面 EPC 写入成功。
  onProgress?.('写EPC成功')

  // 全流程完成后返回 true。
  return true
}

// epcBasebandRate: EPC 基带速率
// defaultQ: 默认 Q 值
// session: Session 参数
// inventoryFlag: 盘存标志参数
export async function configEPCBasebandParam(
  // EPC 基带速率，默认 0x01。
  epcBasebandRate = 0x01,
  // 默认 Q 值，默认 0x04。
  defaultQ = 0x04,
  // Session 参数，默认 0x02。
  session = 0x02,
  // 盘存标志，默认 0x00。
  inventoryFlag = 0x00,
  // 目标会话，可选。
  sessionId?: number
): Promise<void> {
  // 按“参数 ID + 参数值”的协议格式构造 payload。
  const payload = normalizeHex(
    `01 ${toHex(epcBasebandRate)} 02 ${toHex(defaultQ)} 03 ${toHex(session)} 04 ${toHex(inventoryFlag)}`
  )
  // 拼出完整帧。
  const frame = buildFrame(MESSAGE_ID.CONFIG_BASEBAND, payload)

  // 打印联调日志。
  console.log('configEPCBasebandParam:', frame)

  // 发送并等待配置结果。
  return configEPCBasebandParamParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

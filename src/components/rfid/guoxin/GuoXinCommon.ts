// 读卡结束原因码。
export enum ReadCode {
  // 单次操作正常完成。
  SingleComplete = 0x00,
  // 外部发送了停止命令。
  StopCommand = 0x01,
  // 设备硬件异常导致中断。
  HardwareError = 0x02
}

// 功率配置返回码。
export enum PowerConfigCode {
  // 配置成功。
  Success = 0x00,
  // 端口参数不受硬件支持。
  PortParamUnsupported = 0x01,
  // 功率参数不受硬件支持。
  PowerParamUnsupported = 0x02,
  // 保存失败。
  SaveFailed = 0x03
}

// 写 EPC 等写操作的结果码。
export enum WriteResultCode {
  // 写入成功。
  Success = 0x00,
  // 天线端口参数错误。
  AntennaPortError = 0x01,
  // 选择参数错误。
  SelectParamError = 0x02,
  // 写入参数错误。
  WriteParamError = 0x03,
  // CRC 校验错误。
  CrcError = 0x04,
  // 功率不足。
  PowerInsufficient = 0x05,
  // 数据区溢出。
  MemoryOverflow = 0x06,
  // 数据区被锁。
  MemoryLocked = 0x07,
  // 访问密码错误。
  AccessPasswordError = 0x08,
  // 其他标签错误。
  OtherTagError = 0x09,
  // 标签丢失。
  TagLost = 0x0a,
  // 读写器发送指令失败。
  ReaderSendCommandError = 0x0b
}

// 锁操作结果码。
export enum LockResultCode {
  // 锁操作成功。
  Success = 0x00,
  // 天线端口错误。
  AntennaPortError = 0x01,
  // 选择参数错误。
  SelectParamError = 0x02,
  // 锁操作参数错误。
  LockParamError = 0x03,
  // CRC 校验错误。
  CrcError = 0x04,
  // 功率不足。
  PowerInsufficient = 0x05,
  // 数据区溢出。
  MemoryOverflow = 0x06,
  // 数据区被锁。
  MemoryLocked = 0x07,
  // 访问密码错误。
  AccessPasswordError = 0x08,
  // 其他标签错误。
  OtherTagError = 0x09,
  // 标签丢失。
  TagLost = 0x0a,
  // 读写器发送指令失败。
  ReaderSendCommandError = 0x0b
}

// EPC 基带参数配置结果码。
export enum EPCBasebandParamConfigCode {
  // 配置成功。
  Success = 0x00,
  // 不支持该基带速率。
  UnsupportedBasebandRate = 0x01,
  // Q 值非法。
  InvalidQValue = 0x02,
  // Session 参数非法。
  InvalidSession = 0x03,
  // 盘存标志非法。
  InvalidInventoryFlag = 0x04,
  // 其他参数错误。
  OtherParamError = 0x05,
  // 保存失败。
  SaveFailed = 0x06
}

// 停止盘存的返回码。
export enum StopReadResultCode {
  // 停止成功。
  Success = 0x00,
  // 系统错误。
  SystemError = 0x01
}

// 读卡结束原因码到中文描述的映射表。
const readDescMap: Record<number, string> = {
  [ReadCode.SingleComplete]: '单次操作完成',
  [ReadCode.StopCommand]: '收到停止指令',
  [ReadCode.HardwareError]: '硬件故障导致读卡中断'
}

// 功率配置返回码到中文描述的映射表。
const powerConfigDescMap: Record<number, string> = {
  [PowerConfigCode.Success]: '配置成功',
  [PowerConfigCode.PortParamUnsupported]: '端口参数读写器硬件不支持',
  [PowerConfigCode.PowerParamUnsupported]: '功率参数读写器硬件不支持',
  [PowerConfigCode.SaveFailed]: '保存失败'
}

// 写 EPC 结果码到中文描述的映射表。
const writeResultDescMap: Record<number, string> = {
  [WriteResultCode.Success]: '写入成功',
  [WriteResultCode.AntennaPortError]: '天线端口参数错误',
  [WriteResultCode.SelectParamError]: '选择参数错误',
  [WriteResultCode.WriteParamError]: '写入参数错误',
  [WriteResultCode.CrcError]: 'CRC 校验错误',
  [WriteResultCode.PowerInsufficient]: '功率不足',
  [WriteResultCode.MemoryOverflow]: '数据区溢出',
  [WriteResultCode.MemoryLocked]: '数据区被锁定',
  [WriteResultCode.AccessPasswordError]: '访问密码错误',
  [WriteResultCode.OtherTagError]: '其他标签错误',
  [WriteResultCode.TagLost]: '标签丢失',
  [WriteResultCode.ReaderSendCommandError]: '读写器发送指令错误'
}

// 锁操作结果码到中文描述的映射表。
const lockResultDescMap: Record<number, string> = {
  [LockResultCode.Success]: '锁操作成功',
  [LockResultCode.AntennaPortError]: '天线端口错误',
  [LockResultCode.SelectParamError]: '选择参数错误',
  [LockResultCode.LockParamError]: '锁操作参数错误',
  [LockResultCode.CrcError]: 'CRC 校验错误',
  [LockResultCode.PowerInsufficient]: '功率不足',
  [LockResultCode.MemoryOverflow]: '数据区溢出',
  [LockResultCode.MemoryLocked]: '数据区被锁定',
  [LockResultCode.AccessPasswordError]: '访问密码错误',
  [LockResultCode.OtherTagError]: '其他标签错误',
  [LockResultCode.TagLost]: '标签丢失',
  [LockResultCode.ReaderSendCommandError]: '读写器发送指令错误'
}

// EPC 基带参数配置结果码到中文描述的映射表。
const epcBasebandDescMap: Record<number, string> = {
  [EPCBasebandParamConfigCode.Success]: '配置成功',
  [EPCBasebandParamConfigCode.UnsupportedBasebandRate]: '读写器不支持的基带速率',
  [EPCBasebandParamConfigCode.InvalidQValue]: 'Q 值参数错误',
  [EPCBasebandParamConfigCode.InvalidSession]: 'Session 参数错误',
  [EPCBasebandParamConfigCode.InvalidInventoryFlag]: '盘存参数错误',
  [EPCBasebandParamConfigCode.OtherParamError]: '其他参数错误',
  [EPCBasebandParamConfigCode.SaveFailed]: '保存失败'
}

// 停止盘存结果码到中文描述的映射表。
const stopReadDescMap: Record<number, string> = {
  [StopReadResultCode.Success]: '停止成功',
  [StopReadResultCode.SystemError]: '系统错误'
}

// 把任意输入统一转成连续大写 HEX。
export function normalizeHex(input: string) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

// 把数字转成指定宽度的大写 HEX。
export function toHex(value: number, width: number = 2) {
  return Number(value).toString(16).toUpperCase().padStart(width, '0')
}

// 从 payload 里提取首字节状态码。
function parsePayloadCode(payload: string) {
  // 先做 HEX 标准化。
  const clean = normalizeHex(payload)
  // 至少要有 1 个字节。
  if (clean.length < 2) {
    return Number.NaN
  }
  // 只解析首字节作为状态码。
  return parseInt(clean.slice(0, 2), 16)
}

// 按给定映射表把 payload 首字节转换成中文说明。
function describeCode(payload: string, map: Record<number, string>, label: string) {
  // 先把首字节解析成数值状态码。
  const code = parsePayloadCode(payload)
  // 查表拿中文描述。
  const desc = map[code]
  // 命中时直接返回描述。
  if (desc) {
    return desc
  }

  // 未知状态码保留警告日志，便于扩充协议支持。
  console.warn(`未知${label}:`, payload)
  return `未知${label}: ${payload}`
}

// 读取读卡结束原因描述。
export function getReadDesc(payload: string): string {
  return describeCode(payload, readDescMap, '读卡结束原因')
}

// 读取功率配置结果描述。
export function getPowerConfigDesc(payload: string): string {
  return describeCode(payload, powerConfigDescMap, '功率配置结果')
}

// 读取写入结果描述。
export function getWriteResultDesc(payload: string): string {
  return describeCode(payload, writeResultDescMap, '写入结果')
}

// 读取锁操作结果描述。
export function getLockResultDesc(payload: string): string {
  return describeCode(payload, lockResultDescMap, '锁操作结果')
}

// 读取 EPC 基带参数配置结果描述。
export function getEPCBasebandParamConfigDesc(payload: string): string {
  return describeCode(payload, epcBasebandDescMap, 'EPC 基带参数配置结果')
}

// 读取停止盘存结果描述。
export function getStopReadDesc(payload: string): string {
  return describeCode(payload, stopReadDescMap, '停止盘存结果')
}

/**
 * 从十六进制字符串转换为字节数组。
 */
export function hexToBytes(hex: string): number[] {
  // 先把输入规范成连续大写 HEX。
  const cleanHex = normalizeHex(hex)
  // 收集转换后的字节数组。
  const bytes: number[] = []

  // 每两位十六进制字符解析成一个字节。
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.slice(i, i + 2), 16)
    // 只保留合法字节。
    if (!Number.isNaN(byte)) {
      bytes.push(byte)
    }
  }

  return bytes
}

/**
 * 从字节数组转换为十六进制字符串。
 */
export function bytesToHex(bytes: number[]): string {
  return bytes.map((byte) => toHex(byte)).join('')
}

// 提取每个 PID 后面的功率值。
export function extractPowerValues(hexString: string): number[] {
  // 先做标准化。
  const cleanHex = normalizeHex(hexString)
  // 收集每个天线的功率值。
  const powers: number[] = []

  // 每 4 个十六进制字符是一组：前 2 位 PID，后 2 位功率值。
  for (let i = 0; i + 3 < cleanHex.length; i += 4) {
    powers.push(parseInt(cleanHex.slice(i + 2, i + 4), 16))
  }

  return powers
}

// 协议控制字 16 进制解析。
export function decodeControlWord(hex: string) {
  // 先把控制字转成数值。
  const value = parseInt(normalizeHex(hex), 16)
  // 最低 8 位就是消息 ID。
  const messageId = value & 0xff

  return {
    // 原始 HEX。
    hex: normalizeHex(hex),
    // 控制字的整体数值。
    value,
    // bit31-24：协议类型。
    protocolType: (value >>> 24) & 0xff,
    // bit23-16：协议版本。
    protocolVersion: (value >>> 16) & 0xff,
    // bit13：RS485 标志。
    rs485Flag: (value >>> 13) & 0x01,
    // bit12：主动上传标志。
    uploadFlag: (value >>> 12) & 0x01,
    // bit11-8：消息分类。
    messageCategory: (value >>> 8) & 0x0f,
    // bit7-0：消息 ID 数值。
    messageId,
    // 便于直接比较的消息 ID HEX。
    messageIdHex: `0x${toHex(messageId)}`
  }
}

// 把一段 HEX 文本解析成字节数组，同时校验格式合法性。
function parseHexData(input: string) {
  // 先规范化。
  const cleanHex = normalizeHex(input)

  // 只允许合法十六进制字符。
  if (!/^[0-9A-F]+$/.test(cleanHex)) {
    throw new Error('无效的十六进制字符串')
  }

  // 长度必须是偶数。
  if (cleanHex.length % 2 !== 0) {
    throw new Error('十六进制字符串长度必须为偶数')
  }

  // 最终转成字节数组返回。
  return hexToBytes(cleanHex)
}

// 计算 payload 长度。
export function calculateDataLength(
  input: string | number,
  padLength: number = 4
): {
  hexLength: string
  decimalLength: number
  byteCount: number
  dataArray: number[]
} {
  // 传数字时，认为调用方传入的就是目标字节数。
  if (typeof input === 'number') {
    const byteCount = input
    return {
      hexLength: toHex(byteCount, padLength),
      decimalLength: byteCount,
      byteCount,
      dataArray: []
    }
  }

  // 传 HEX 字符串时，先解析成字节数组。
  const dataArray = parseHexData(input)
  // 真实字节长度就是数组长度。
  const byteCount = dataArray.length

  return {
    hexLength: toHex(byteCount, padLength),
    decimalLength: byteCount,
    byteCount,
    dataArray
  }
}

/**
 * 根据匹配数据（十六进制字符串）计算协议中的匹配数据位长度字段。
 */
export function calcMatchBitLength(matchHex: string): {
  bitLength: number
  hexField: string
} {
  // 先标准化匹配数据。
  const clean = normalizeHex(matchHex)

  // 只允许合法十六进制内容。
  if (!/^[0-9A-F]+$/.test(clean)) {
    throw new Error('匹配数据不是有效的十六进制字符串')
  }

  // 十六进制每个字符对应 4 bit。
  const bitLength = clean.length * 4

  return {
    // 十进制位长度。
    bitLength,
    // 协议字段里使用的 HEX 位长度。
    hexField: toHex(bitLength, 2)
  }
}

// 天线数组转 16 进制掩码。
export function antsToHexMask(ants: number[]): string {
  // 从 0 掩码开始累计。
  let mask = 0

  // 每根天线对应一个 bit 位。
  for (const ant of ants) {
    // 协议里天线下标从 1 开始，且最多支持 32 根。
    if (ant < 1 || ant > 32) {
      throw new Error(`Invalid antenna index: ${ant}`)
    }
    // 把当前天线对应位置 1。
    mask = (mask | (1 << (ant - 1))) >>> 0
  }

  // 最终按 4 字节无符号整型输出 8 位 HEX。
  return toHex(mask, 8)
}

/**
 * PID 定义。
 */
const RFID_PID = {
  // RSSI 强度 PID。
  RSSI: 0x01,
  // 读结果 PID。
  READ_RESULT: 0x02,
  // TID 数据 PID。
  TID_DATA: 0x03,
  // 当前频点 PID。
  CURRENT_FREQUENCY: 0x08,
  // 标签相位 PID。
  TAG_PHASE: 0x09
} as const

// 所有当前支持解析的 PID 集合。
const KNOWN_RFID_PIDS = new Set<number>([
  RFID_PID.RSSI,
  RFID_PID.READ_RESULT,
  RFID_PID.TID_DATA,
  RFID_PID.CURRENT_FREQUENCY,
  RFID_PID.TAG_PHASE
])

export interface IRFIDTagReadMessage {
  // EPC 长度，单位字节。
  epcLength: number
  // EPC 数据本体。
  epc: string
  // PC 值。
  pcValue: string
  // 天线编号。
  antennaId: number
  rssi: {
    // RSSI 对应的 PID。
    pid: number
    // RSSI 数值。
    value: number
  }
  readResult: {
    // 读结果对应的 PID。
    pid: number
    // 是否成功。
    success: boolean
  }
  tidData: {
    // TID 对应的 PID。
    pid: number
    // TID 长度，单位字节。
    length: number
    // TID 数据。
    data: string
  }
  currentFrequency: {
    // 频点对应的 PID。
    pid: number
    // 当前频率，单位 MHz。
    frequency: number
  }
  tagPhase: {
    // 相位对应的 PID。
    pid: number
    // 相位值。
    phase: number
  }
  // 调试时保留原始消息。
  rawMessage?: string
}

// 解析过程中用于顺序读取 HEX 的游标。
type HexCursor = {
  // 当前处理的整段 HEX。
  hex: string
  // 当前读取位置。
  index: number
}

// 判断游标后面是否还够读取指定字符数。
function canRead(cursor: HexCursor, chars: number) {
  return cursor.index + chars <= cursor.hex.length
}

// 从游标当前位置读取指定长度的 HEX，并推进游标。
function readHex(cursor: HexCursor, chars: number): string | null {
  // 不够读时返回 null。
  if (!canRead(cursor, chars)) {
    return null
  }

  // 截取当前位置到目标长度的片段。
  const value = cursor.hex.slice(cursor.index, cursor.index + chars)
  // 推进游标。
  cursor.index += chars
  // 返回本次读取结果。
  return value
}

// 允许直接传完整帧或仅传 payload；这里负责把 payload 部分切出来。
function extractPayloadHex(hex: string) {
  // 不是完整国芯帧时，直接按 payload 看待。
  if (!hex.startsWith('5A') || hex.length < 14) {
    return hex
  }

  // 从完整帧里读取 payload 长度字段。
  const payloadLength = parseInt(hex.slice(10, 14), 16)
  // 长度字段非法时，回退成“原样返回”。
  if (Number.isNaN(payloadLength)) {
    return hex
  }

  // 计算 payload 截止位置。
  const payloadEnd = 14 + payloadLength * 2
  // 完整帧长度足够时，严格按长度截出 payload。
  if (payloadEnd <= hex.length) {
    return hex.slice(14, payloadEnd)
  }

  // 长度字段大于实际内容时，仍尽量把后半段视为 payload。
  return hex.slice(14)
}

// 解析 EPC 读取 payload 的头部格式，兼容两种长度字段宽度。
function resolveEpcHeader(payloadHex: string) {
  const minTailChars = 6 // PC(4) + antenna(2)
  const headerCandidates = [4, 2]

  // 依次尝试 2 字节长度字段和 1 字节长度字段。
  for (const headerChars of headerCandidates) {
    // 当前 payload 长度连最小头部都不够时，直接跳过这种格式。
    if (payloadHex.length < headerChars + minTailChars) {
      continue
    }

    // 取出 EPC 长度字段。
    const epcLengthHex = payloadHex.slice(0, headerChars)
    // 解析 EPC 长度。
    const epcLength = parseInt(epcLengthHex, 16)
    // 长度字段非法时尝试下一种格式。
    if (Number.isNaN(epcLength)) {
      continue
    }

    // 计算“当前格式下至少需要的字符数”。
    const minRequiredChars = headerChars + epcLength * 2 + minTailChars
    // 如果当前 payload 足够覆盖 EPC + PC + antenna，就接受这种格式。
    if (minRequiredChars <= payloadHex.length) {
      return {
        headerChars,
        epcLength
      }
    }
  }

  return null
}

// 解析 RSSI PID 对应的 1 字节数据。
function parseRssi(message: Partial<IRFIDTagReadMessage>, cursor: HexCursor, pid: number) {
  const rssiHex = readHex(cursor, 2)
  if (!rssiHex) {
    return false
  }

  message.rssi = {
    pid,
    value: parseInt(rssiHex, 16)
  }

  return true
}

// 解析读结果 PID 对应的 1 字节成功/失败标志。
function parseReadResult(message: Partial<IRFIDTagReadMessage>, cursor: HexCursor, pid: number) {
  const resultHex = readHex(cursor, 2)
  if (!resultHex) {
    return false
  }

  message.readResult = {
    pid,
    success: parseInt(resultHex, 16) === 0x00
  }

  return true
}

// 解析 TID PID：先读长度，再按长度读取 TID 数据。
function parseTidData(message: Partial<IRFIDTagReadMessage>, cursor: HexCursor, pid: number) {
  const tidLengthHex = readHex(cursor, 4)
  if (!tidLengthHex) {
    return false
  }

  // TID 长度字段单位是字节。
  const tidLength = parseInt(tidLengthHex, 16)
  // 按字节长度转换成字符长度后读取真实 TID 数据。
  const tidData = readHex(cursor, tidLength * 2)
  if (!tidData) {
    return false
  }

  message.tidData = {
    pid,
    length: tidLength,
    data: tidData
  }

  return true
}

// 频点字段有 3 字节和 4 字节两种长度，这里动态判断当前该读几位。
function resolveFrequencyChars(cursor: HexCursor) {
  // 先计算剩余未读字符数。
  const remaining = cursor.hex.length - cursor.index
  // 连 3 字节都不够时，无法解析频点。
  if (remaining < 6) {
    return null
  }

  // 如果只够 3 字节但不够 4 字节，就按 3 字节频点处理。
  if (remaining < 8) {
    return 6
  }

  // 看 3 字节后面紧接着的那个字节是否像一个已知 PID。
  const nextPidHex = cursor.hex.slice(cursor.index + 6, cursor.index + 8)
  const nextPid = parseInt(nextPidHex, 16)
  // 如果命中了已知 PID，说明当前频点应当按 3 字节读取。
  if (KNOWN_RFID_PIDS.has(nextPid)) {
    return 6
  }

  // 否则按 4 字节读取。
  return 8
}

// 解析当前频点 PID。
function parseCurrentFrequency(
  message: Partial<IRFIDTagReadMessage>,
  cursor: HexCursor,
  pid: number
) {
  // 先判断当前频点字段应读取几位。
  const freqChars = resolveFrequencyChars(cursor)
  if (!freqChars) {
    return false
  }

  // 再读取实际频点值。
  const freqHex = readHex(cursor, freqChars)
  if (!freqHex) {
    return false
  }

  message.currentFrequency = {
    pid,
    // 协议里频率值按 kHz 存储，这里转成 MHz。
    frequency: parseInt(freqHex, 16) / 1000
  }

  return true
}

// 解析标签相位 PID。
function parseTagPhase(message: Partial<IRFIDTagReadMessage>, cursor: HexCursor, pid: number) {
  const phaseHex = readHex(cursor, 2)
  if (!phaseHex) {
    return false
  }

  message.tagPhase = {
    pid,
    phase: parseInt(phaseHex, 16)
  }

  return true
}

// 未知 PID 先按“跳过 1 字节数据”处理，避免整个解析流程立刻崩掉。
function parseUnknownPid(cursor: HexCursor) {
  return readHex(cursor, 2) !== null
}

// 根据 PID 分发到不同的字段解析器。
function parsePidBlock(message: Partial<IRFIDTagReadMessage>, cursor: HexCursor, pid: number) {
  switch (pid) {
    // RSSI 强度。
    case RFID_PID.RSSI:
      return parseRssi(message, cursor, pid)
    // 读结果。
    case RFID_PID.READ_RESULT:
      return parseReadResult(message, cursor, pid)
    // TID 数据。
    case RFID_PID.TID_DATA:
      return parseTidData(message, cursor, pid)
    // 当前频点。
    case RFID_PID.CURRENT_FREQUENCY:
      return parseCurrentFrequency(message, cursor, pid)
    // 标签相位。
    case RFID_PID.TAG_PHASE:
      return parseTagPhase(message, cursor, pid)
    // 未知 PID。
    default:
      return parseUnknownPid(cursor)
  }
}

/**
 * 解析 RFID 标签读取消息（可传整帧或 payload）。
 */
export function parseEPCMessage(hexString: string): IRFIDTagReadMessage | null {
  // 先把输入规范成连续大写 HEX。
  const cleanHex = normalizeHex(hexString)
  // 空串或包含非法字符时直接返回 null。
  if (!cleanHex || !/^[0-9A-F]+$/.test(cleanHex)) {
    return null
  }

  // 允许直接传完整帧，所以先把 payload 片段抽出来。
  const payloadHex = extractPayloadHex(cleanHex)
  // 识别 EPC 头部格式。
  const header = resolveEpcHeader(payloadHex)
  // 识别失败时说明不是当前支持的 EPC 读取消息。
  if (!header) {
    return null
  }

  // 先构造一份部分结果对象。
  const message: Partial<IRFIDTagReadMessage> = {
    rawMessage: cleanHex,
    epcLength: header.epcLength
  }

  // 创建读取游标，从 EPC 内容起始位置开始顺序向后读。
  const cursor: HexCursor = {
    hex: payloadHex,
    index: header.headerChars
  }

  // 按固定顺序读取 EPC、PC 和天线号。
  const epc = readHex(cursor, header.epcLength * 2)
  const pcValue = readHex(cursor, 4)
  const antenna = readHex(cursor, 2)
  // 关键基础字段不完整时，认为整条消息无效。
  if (!epc || !pcValue || !antenna) {
    return null
  }

  // 写入基础字段。
  message.epc = epc
  message.pcValue = pcValue
  message.antennaId = parseInt(antenna, 16)

  // 剩余部分按 PID + 数据块结构依次解析。
  while (canRead(cursor, 2)) {
    // 先读取 1 字节 PID。
    const pidHex = readHex(cursor, 2)
    if (!pidHex) {
      break
    }

    // 转成数字 PID。
    const pid = parseInt(pidHex, 16)
    // 交给对应 PID 解析器处理。
    const parsed = parsePidBlock(message, cursor, pid)
    // 当前 PID 无法继续解析时，停止后续解析。
    if (!parsed) {
      break
    }
  }

  // 最终把部分对象断言成完整消息返回。
  return message as IRFIDTagReadMessage
}

// 把完整国芯协议帧解析成结构化对象。
export function parseFrame(input: string) {
  // 先标准化原始输入。
  const hex = normalizeHex(input)

  // 不能解析空内容。
  if (!hex) {
    throw new Error('返回内容为空')
  }

  // HEX 字符串长度必须是偶数。
  if (hex.length % 2 !== 0) {
    throw new Error('HEX 长度不是偶数')
  }

  // 完整帧至少要包含帧头、控制字、长度和 CRC。
  if (hex.length < 18) {
    throw new Error('数据长度不足')
  }

  // 校验帧头。
  const frameHead = hex.slice(0, 2)
  if (frameHead !== '5A') {
    throw new Error(`帧头错误: ${frameHead}`)
  }

  // 读取控制字。
  const controlHex = hex.slice(2, 10)
  // 读取长度字段。
  const lengthHex = hex.slice(10, 14)
  // 解析 payload 字节长度。
  const payloadLength = parseInt(lengthHex, 16)
  if (Number.isNaN(payloadLength)) {
    throw new Error('长度字段非法')
  }

  // payload 起始位置固定在长度字段后。
  const payloadStart = 14
  // 根据长度字段计算 payload 结束位置。
  const payloadEnd = payloadStart + payloadLength * 2
  // CRC 紧跟在 payload 之后。
  const crcEnd = payloadEnd + 4
  // 如果实际内容不够覆盖 payload + CRC，说明长度字段不可信。
  if (hex.length < crcEnd) {
    throw new Error('长度字段与实际数据不一致')
  }

  // 截出 payload。
  const payloadHex = hex.slice(payloadStart, payloadEnd)
  // 截出 CRC。
  const crc = hex.slice(payloadEnd, crcEnd)
  // 解析控制字内部字段。
  const controlWord = decodeControlWord(controlHex)

  return {
    // 帧头。
    frameHead,
    // 控制字解析结果。
    controlWord,
    // 直接给出 `0x??` 形式的消息 ID，便于业务层比较。
    mid: controlWord.messageIdHex,
    length: {
      // 原始 HEX 长度字段。
      hex: lengthHex,
      // 十进制字节长度。
      value: payloadLength
    },
    // payload 本体。
    payload: payloadHex,
    // 原始 CRC。
    crc
  } as Record<string, unknown>
}

// 计算国芯协议里使用的 CRC16-CCITT。
export const crc16Ccitt = (hex: string) => {
  // 先标准化输入。
  const clean = normalizeHex(hex)
  // 初始值为 0x0000。
  let crc = 0x0000

  // 每次处理 1 个字节。
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16)
    // 先把字节并入高位。
    crc ^= byte << 8

    // 再按 CCITT 多项式处理 8 个 bit。
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xffff
    }
  }

  return toHex(crc, 4)
}

export interface ControlWordParams {
  /** 协议类型号 (bit 31-24)，默认 0（UHF RFID 读写器协议） */
  protocolType?: number
  /** 协议版本号 (bit 23-16)，默认 1（即 0x01） */
  protocolVersion?: number
  /** RS485 标志位 (bit 13)，0 或 1 */
  rs485Flag?: 0 | 1
  /** 读写器主动上传标志位 (bit 12)，0 或 1 */
  uploadFlag?: 0 | 1
  /** 消息类别号 (bit 11-8)，0~5 常用 */
  messageCategory: number
  /** 消息 ID (bit 7-0)，0x00~0xFF */
  messageId: number
}

/**
 * 生成协议控制字。
 */
export function generateControlWord(params: ControlWordParams): {
  value: number
  hex: string
  bytes: Uint8Array
  byteString: string
} {
  // 给未传入的字段补默认值。
  const {
    protocolType = 0,
    protocolVersion = 1,
    rs485Flag = 0,
    uploadFlag = 0,
    messageCategory = 2,
    messageId
  } = params

  // 按协议位段把每个字段拼成 32 位控制字。
  const value = (
    (protocolType << 24) |
    (protocolVersion << 16) |
    (rs485Flag << 13) |
    (uploadFlag << 12) |
    (messageCategory << 8) |
    messageId
  ) >>> 0

  // 转成 8 位 HEX 便于直接拼帧。
  const hex = toHex(value, 8)

  // 额外生成一个 4 字节数组，供需要字节级调试的场景使用。
  const bytes = new Uint8Array(4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, value, false)

  // 再生成一个“按空格分隔”的字节串，方便日志展示。
  const byteString = Array.from(bytes)
    .map((byte) => toHex(byte))
    .join(' ')

  return {
    // 控制字整体数值。
    value,
    // 8 位 HEX 表示。
    hex,
    // 4 字节数组表示。
    bytes,
    // 便于肉眼查看的字节串。
    byteString
  }
}

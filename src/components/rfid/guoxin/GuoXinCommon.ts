export enum ReadCode {
  SingleComplete = 0x00,
  StopCommand = 0x01,
  HardwareError = 0x02
}

export enum PowerConfigCode {
  Success = 0x00,
  PortParamUnsupported = 0x01,
  PowerParamUnsupported = 0x02,
  SaveFailed = 0x03
}

export enum WriteResultCode {
  Success = 0x00,
  AntennaPortError = 0x01,
  SelectParamError = 0x02,
  WriteParamError = 0x03,
  CrcError = 0x04,
  PowerInsufficient = 0x05,
  MemoryOverflow = 0x06,
  MemoryLocked = 0x07,
  AccessPasswordError = 0x08,
  OtherTagError = 0x09,
  TagLost = 0x0a,
  ReaderSendCommandError = 0x0b
}

export enum LockResultCode {
  Success = 0x00,
  AntennaPortError = 0x01,
  SelectParamError = 0x02,
  LockParamError = 0x03,
  CrcError = 0x04,
  PowerInsufficient = 0x05,
  MemoryOverflow = 0x06,
  MemoryLocked = 0x07,
  AccessPasswordError = 0x08,
  OtherTagError = 0x09,
  TagLost = 0x0a,
  ReaderSendCommandError = 0x0b
}

export enum EPCBasebandParamConfigCode {
  Success = 0x00,
  UnsupportedBasebandRate = 0x01,
  InvalidQValue = 0x02,
  InvalidSession = 0x03,
  InvalidInventoryFlag = 0x04,
  OtherParamError = 0x05,
  SaveFailed = 0x06
}

export enum StopReadResultCode {
  Success = 0x00,
  SystemError = 0x01
}

const readDescMap: Record<number, string> = {
  [ReadCode.SingleComplete]: '单次操作完成',
  [ReadCode.StopCommand]: '收到停止指令',
  [ReadCode.HardwareError]: '硬件故障导致读卡中断'
}

const powerConfigDescMap: Record<number, string> = {
  [PowerConfigCode.Success]: '配置成功',
  [PowerConfigCode.PortParamUnsupported]: '端口参数读写器硬件不支持',
  [PowerConfigCode.PowerParamUnsupported]: '功率参数读写器硬件不支持',
  [PowerConfigCode.SaveFailed]: '保存失败'
}

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

const epcBasebandDescMap: Record<number, string> = {
  [EPCBasebandParamConfigCode.Success]: '配置成功',
  [EPCBasebandParamConfigCode.UnsupportedBasebandRate]: '读写器不支持的基带速率',
  [EPCBasebandParamConfigCode.InvalidQValue]: 'Q 值参数错误',
  [EPCBasebandParamConfigCode.InvalidSession]: 'Session 参数错误',
  [EPCBasebandParamConfigCode.InvalidInventoryFlag]: '盘存参数错误',
  [EPCBasebandParamConfigCode.OtherParamError]: '其他参数错误',
  [EPCBasebandParamConfigCode.SaveFailed]: '保存失败'
}

const stopReadDescMap: Record<number, string> = {
  [StopReadResultCode.Success]: '停止成功',
  [StopReadResultCode.SystemError]: '系统错误'
}

export function normalizeHex(input: string) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

export function toHex(value: number, width: number = 2) {
  return Number(value).toString(16).toUpperCase().padStart(width, '0')
}

function parsePayloadCode(payload: string) {
  const clean = normalizeHex(payload)
  if (clean.length < 2) {
    return Number.NaN
  }
  return parseInt(clean.slice(0, 2), 16)
}

function describeCode(payload: string, map: Record<number, string>, label: string) {
  const code = parsePayloadCode(payload)
  const desc = map[code]
  if (desc) {
    return desc
  }

  console.warn(`未知${label}:`, payload)
  return `未知${label}: ${payload}`
}

export function getReadDesc(payload: string): string {
  return describeCode(payload, readDescMap, '读卡结束原因')
}

export function getPowerConfigDesc(payload: string): string {
  return describeCode(payload, powerConfigDescMap, '功率配置结果')
}

export function getWriteResultDesc(payload: string): string {
  return describeCode(payload, writeResultDescMap, '写入结果')
}

export function getLockResultDesc(payload: string): string {
  return describeCode(payload, lockResultDescMap, '锁操作结果')
}

export function getEPCBasebandParamConfigDesc(payload: string): string {
  return describeCode(payload, epcBasebandDescMap, 'EPC 基带参数配置结果')
}

export function getStopReadDesc(payload: string): string {
  return describeCode(payload, stopReadDescMap, '停止盘存结果')
}

/**
 * 从十六进制字符串转换为字节数组。
 */
export function hexToBytes(hex: string): number[] {
  const cleanHex = normalizeHex(hex)
  const bytes: number[] = []

  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.slice(i, i + 2), 16)
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
  const cleanHex = normalizeHex(hexString)
  const powers: number[] = []

  for (let i = 0; i + 3 < cleanHex.length; i += 4) {
    powers.push(parseInt(cleanHex.slice(i + 2, i + 4), 16))
  }

  return powers
}

// 协议控制字 16 进制解析。
export function decodeControlWord(hex: string) {
  const value = parseInt(normalizeHex(hex), 16)
  const messageId = value & 0xff

  return {
    hex: normalizeHex(hex),
    value,
    protocolType: (value >>> 24) & 0xff,
    protocolVersion: (value >>> 16) & 0xff,
    rs485Flag: (value >>> 13) & 0x01,
    uploadFlag: (value >>> 12) & 0x01,
    messageCategory: (value >>> 8) & 0x0f,
    messageId,
    messageIdHex: `0x${toHex(messageId)}`
  }
}

function parseHexData(input: string) {
  const cleanHex = normalizeHex(input)

  if (!/^[0-9A-F]+$/.test(cleanHex)) {
    throw new Error('无效的十六进制字符串')
  }

  if (cleanHex.length % 2 !== 0) {
    throw new Error('十六进制字符串长度必须为偶数')
  }

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
  if (typeof input === 'number') {
    const byteCount = input
    return {
      hexLength: toHex(byteCount, padLength),
      decimalLength: byteCount,
      byteCount,
      dataArray: []
    }
  }

  const dataArray = parseHexData(input)
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
  const clean = normalizeHex(matchHex)

  if (!/^[0-9A-F]+$/.test(clean)) {
    throw new Error('匹配数据不是有效的十六进制字符串')
  }

  const bitLength = clean.length * 4

  return {
    bitLength,
    hexField: toHex(bitLength, 2)
  }
}

// 天线数组转 16 进制掩码。
export function antsToHexMask(ants: number[]): string {
  let mask = 0

  for (const ant of ants) {
    if (ant < 1 || ant > 32) {
      throw new Error(`Invalid antenna index: ${ant}`)
    }
    mask = (mask | (1 << (ant - 1))) >>> 0
  }

  return toHex(mask, 8)
}

/**
 * PID 定义。
 */
const RFID_PID = {
  RSSI: 0x01,
  READ_RESULT: 0x02,
  TID_DATA: 0x03,
  CURRENT_FREQUENCY: 0x08,
  TAG_PHASE: 0x09
} as const

const KNOWN_RFID_PIDS = new Set<number>([
  RFID_PID.RSSI,
  RFID_PID.READ_RESULT,
  RFID_PID.TID_DATA,
  RFID_PID.CURRENT_FREQUENCY,
  RFID_PID.TAG_PHASE
])

export interface IRFIDTagReadMessage {
  epcLength: number
  epc: string
  pcValue: string
  antennaId: number
  rssi: {
    pid: number
    value: number
  }
  readResult: {
    pid: number
    success: boolean
  }
  tidData: {
    pid: number
    length: number
    data: string
  }
  currentFrequency: {
    pid: number
    frequency: number
  }
  tagPhase: {
    pid: number
    phase: number
  }
  rawMessage?: string
}

type HexCursor = {
  hex: string
  index: number
}

function canRead(cursor: HexCursor, chars: number) {
  return cursor.index + chars <= cursor.hex.length
}

function readHex(cursor: HexCursor, chars: number): string | null {
  if (!canRead(cursor, chars)) {
    return null
  }

  const value = cursor.hex.slice(cursor.index, cursor.index + chars)
  cursor.index += chars
  return value
}

function extractPayloadHex(hex: string) {
  if (!hex.startsWith('5A') || hex.length < 14) {
    return hex
  }

  const payloadLength = parseInt(hex.slice(10, 14), 16)
  if (Number.isNaN(payloadLength)) {
    return hex
  }

  const payloadEnd = 14 + payloadLength * 2
  if (payloadEnd <= hex.length) {
    return hex.slice(14, payloadEnd)
  }

  return hex.slice(14)
}

function resolveEpcHeader(payloadHex: string) {
  const minTailChars = 6 // PC(4) + antenna(2)
  const headerCandidates = [4, 2]

  for (const headerChars of headerCandidates) {
    if (payloadHex.length < headerChars + minTailChars) {
      continue
    }

    const epcLengthHex = payloadHex.slice(0, headerChars)
    const epcLength = parseInt(epcLengthHex, 16)
    if (Number.isNaN(epcLength)) {
      continue
    }

    const minRequiredChars = headerChars + epcLength * 2 + minTailChars
    if (minRequiredChars <= payloadHex.length) {
      return {
        headerChars,
        epcLength
      }
    }
  }

  return null
}

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

function parseTidData(message: Partial<IRFIDTagReadMessage>, cursor: HexCursor, pid: number) {
  const tidLengthHex = readHex(cursor, 4)
  if (!tidLengthHex) {
    return false
  }

  const tidLength = parseInt(tidLengthHex, 16)
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

function resolveFrequencyChars(cursor: HexCursor) {
  const remaining = cursor.hex.length - cursor.index
  if (remaining < 6) {
    return null
  }

  if (remaining < 8) {
    return 6
  }

  const nextPidHex = cursor.hex.slice(cursor.index + 6, cursor.index + 8)
  const nextPid = parseInt(nextPidHex, 16)
  if (KNOWN_RFID_PIDS.has(nextPid)) {
    return 6
  }

  return 8
}

function parseCurrentFrequency(
  message: Partial<IRFIDTagReadMessage>,
  cursor: HexCursor,
  pid: number
) {
  const freqChars = resolveFrequencyChars(cursor)
  if (!freqChars) {
    return false
  }

  const freqHex = readHex(cursor, freqChars)
  if (!freqHex) {
    return false
  }

  message.currentFrequency = {
    pid,
    frequency: parseInt(freqHex, 16) / 1000
  }

  return true
}

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

function parseUnknownPid(cursor: HexCursor) {
  return readHex(cursor, 2) !== null
}

function parsePidBlock(message: Partial<IRFIDTagReadMessage>, cursor: HexCursor, pid: number) {
  switch (pid) {
    case RFID_PID.RSSI:
      return parseRssi(message, cursor, pid)
    case RFID_PID.READ_RESULT:
      return parseReadResult(message, cursor, pid)
    case RFID_PID.TID_DATA:
      return parseTidData(message, cursor, pid)
    case RFID_PID.CURRENT_FREQUENCY:
      return parseCurrentFrequency(message, cursor, pid)
    case RFID_PID.TAG_PHASE:
      return parseTagPhase(message, cursor, pid)
    default:
      return parseUnknownPid(cursor)
  }
}

/**
 * 解析 RFID 标签读取消息（可传整帧或 payload）。
 */
export function parseEPCMessage(hexString: string): IRFIDTagReadMessage | null {
  const cleanHex = normalizeHex(hexString)
  if (!cleanHex || !/^[0-9A-F]+$/.test(cleanHex)) {
    return null
  }

  const payloadHex = extractPayloadHex(cleanHex)
  const header = resolveEpcHeader(payloadHex)
  if (!header) {
    return null
  }

  const message: Partial<IRFIDTagReadMessage> = {
    rawMessage: cleanHex,
    epcLength: header.epcLength
  }

  const cursor: HexCursor = {
    hex: payloadHex,
    index: header.headerChars
  }

  const epc = readHex(cursor, header.epcLength * 2)
  const pcValue = readHex(cursor, 4)
  const antenna = readHex(cursor, 2)
  if (!epc || !pcValue || !antenna) {
    return null
  }

  message.epc = epc
  message.pcValue = pcValue
  message.antennaId = parseInt(antenna, 16)

  while (canRead(cursor, 2)) {
    const pidHex = readHex(cursor, 2)
    if (!pidHex) {
      break
    }

    const pid = parseInt(pidHex, 16)
    const parsed = parsePidBlock(message, cursor, pid)
    if (!parsed) {
      break
    }
  }

  return message as IRFIDTagReadMessage
}

export function parseFrame(input: string) {
  const hex = normalizeHex(input)

  if (!hex) {
    throw new Error('返回内容为空')
  }

  if (hex.length % 2 !== 0) {
    throw new Error('HEX 长度不是偶数')
  }

  if (hex.length < 18) {
    throw new Error('数据长度不足')
  }

  const frameHead = hex.slice(0, 2)
  if (frameHead !== '5A') {
    throw new Error(`帧头错误: ${frameHead}`)
  }

  const controlHex = hex.slice(2, 10)
  const lengthHex = hex.slice(10, 14)
  const payloadLength = parseInt(lengthHex, 16)
  if (Number.isNaN(payloadLength)) {
    throw new Error('长度字段非法')
  }

  const payloadStart = 14
  const payloadEnd = payloadStart + payloadLength * 2
  const crcEnd = payloadEnd + 4
  if (hex.length < crcEnd) {
    throw new Error('长度字段与实际数据不一致')
  }

  const payloadHex = hex.slice(payloadStart, payloadEnd)
  const crc = hex.slice(payloadEnd, crcEnd)
  const controlWord = decodeControlWord(controlHex)

  return {
    frameHead,
    controlWord,
    mid: controlWord.messageIdHex,
    length: {
      hex: lengthHex,
      value: payloadLength
    },
    payload: payloadHex,
    crc
  } as Record<string, unknown>
}

export const crc16Ccitt = (hex: string) => {
  const clean = normalizeHex(hex)
  let crc = 0x0000

  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16)
    crc ^= byte << 8

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
  const {
    protocolType = 0,
    protocolVersion = 1,
    rs485Flag = 0,
    uploadFlag = 0,
    messageCategory = 2,
    messageId
  } = params

  const value = (
    (protocolType << 24) |
    (protocolVersion << 16) |
    (rs485Flag << 13) |
    (uploadFlag << 12) |
    (messageCategory << 8) |
    messageId
  ) >>> 0

  const hex = toHex(value, 8)

  const bytes = new Uint8Array(4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, value, false)

  const byteString = Array.from(bytes)
    .map((byte) => toHex(byte))
    .join(' ')

  return {
    value,
    hex,
    bytes,
    byteString
  }
}

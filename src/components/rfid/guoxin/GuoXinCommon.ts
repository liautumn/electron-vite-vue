export enum ReadCode {
  SingleComplete = 0x00,
  StopCommand = 0x01,
  HardwareError = 0x02
}

export function getReadDesc(payload: string): string {
  const code = parseInt(payload, 16) as unknown as ReadCode
  switch (code) {
    case ReadCode.SingleComplete:
      console.log('单次操作完成')
      return '单次操作完成'

    case ReadCode.StopCommand:
      console.log('收到停止指令')
      return '收到停止指令'

    case ReadCode.HardwareError:
      console.log('硬件故障导致读卡中断')
      return '硬件故障导致读卡中断'

    default:
      console.warn('未知读卡结束原因:', payload)
      return '未知读卡结束原因: ' + payload
  }
}

export enum PowerConfigCode {
  Success = 0x00,
  PortParamUnsupported = 0x01,
  PowerParamUnsupported = 0x02,
  SaveFailed = 0x03
}

export function getPowerConfigDesc(payload: string): string {
  const cleanPayload = normalizeHex(payload)
  const code = parseInt(cleanPayload.slice(0, 2), 16) as unknown as PowerConfigCode
  switch (code) {
    case PowerConfigCode.Success:
      return '配置成功'
    case PowerConfigCode.PortParamUnsupported:
      return '端口参数读写器硬件不支持'
    case PowerConfigCode.PowerParamUnsupported:
      return '功率参数读写器硬件不支持'
    case PowerConfigCode.SaveFailed:
      return '保存失败'
    default:
      console.warn('未知功率配置结果:', payload)
      return '未知功率配置结果: ' + payload
  }
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

export function getWriteResultDesc(payload: string): string {
  const cleanPayload = normalizeHex(payload)
  const code = parseInt(cleanPayload.slice(0, 2), 16) as unknown as WriteResultCode
  switch (code) {
    case WriteResultCode.Success:
      return '写入成功'
    case WriteResultCode.AntennaPortError:
      return '天线端口参数错误'
    case WriteResultCode.SelectParamError:
      return '选择参数错误'
    case WriteResultCode.WriteParamError:
      return '写入参数错误'
    case WriteResultCode.CrcError:
      return 'CRC 校验错误'
    case WriteResultCode.PowerInsufficient:
      return '功率不足'
    case WriteResultCode.MemoryOverflow:
      return '数据区溢出'
    case WriteResultCode.MemoryLocked:
      return '数据区被锁定'
    case WriteResultCode.AccessPasswordError:
      return '访问密码错误'
    case WriteResultCode.OtherTagError:
      return '其他标签错误'
    case WriteResultCode.TagLost:
      return '标签丢失'
    case WriteResultCode.ReaderSendCommandError:
      return '读写器发送指令错误'
    default:
      console.warn('未知写入结果:', payload)
      return '未知写入结果: ' + payload
  }
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

export function getLockResultDesc(payload: string): string {
  const cleanPayload = normalizeHex(payload)
  const code = parseInt(cleanPayload.slice(0, 2), 16) as unknown as LockResultCode
  switch (code) {
    case LockResultCode.Success:
      return '锁操作成功'
    case LockResultCode.AntennaPortError:
      return '天线端口错误'
    case LockResultCode.SelectParamError:
      return '选择参数错误'
    case LockResultCode.LockParamError:
      return '锁操作参数错误'
    case LockResultCode.CrcError:
      return 'CRC 校验错误'
    case LockResultCode.PowerInsufficient:
      return '功率不足'
    case LockResultCode.MemoryOverflow:
      return '数据区溢出'
    case LockResultCode.MemoryLocked:
      return '数据区被锁定'
    case LockResultCode.AccessPasswordError:
      return '访问密码错误'
    case LockResultCode.OtherTagError:
      return '其他标签错误'
    case LockResultCode.TagLost:
      return '标签丢失'
    case LockResultCode.ReaderSendCommandError:
      return '读写器发送指令错误'
    default:
      console.warn('未知锁操作结果:', payload)
      return '未知锁操作结果: ' + payload
  }
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

export function getEPCBasebandParamConfigDesc(payload: string): string {
  const cleanPayload = normalizeHex(payload)
  const code = parseInt(cleanPayload.slice(0, 2), 16) as unknown as EPCBasebandParamConfigCode
  switch (code) {
    case EPCBasebandParamConfigCode.Success:
      return '配置成功'
    case EPCBasebandParamConfigCode.UnsupportedBasebandRate:
      return '读写器不支持的基带速率'
    case EPCBasebandParamConfigCode.InvalidQValue:
      return 'Q 值参数错误'
    case EPCBasebandParamConfigCode.InvalidSession:
      return 'Session 参数错误'
    case EPCBasebandParamConfigCode.InvalidInventoryFlag:
      return '盘存参数错误'
    case EPCBasebandParamConfigCode.OtherParamError:
      return '其他参数错误'
    case EPCBasebandParamConfigCode.SaveFailed:
      return '保存失败'
    default:
      console.warn('未知 EPC 基带参数配置结果:', payload)
      return '未知 EPC 基带参数配置结果: ' + payload
  }
}

export enum StopReadResultCode {
  Success = 0x00,
  SystemError = 0x01
}

export function getStopReadDesc(payload: string): string {
  const cleanPayload = normalizeHex(payload)
  const code = parseInt(cleanPayload.slice(0, 2), 16) as unknown as StopReadResultCode
  switch (code) {
    case StopReadResultCode.Success:
      return '停止成功'
    case StopReadResultCode.SystemError:
      return '系统错误'
    default:
      console.warn('未知停止盘存结果:', payload)
      return '未知停止盘存结果: ' + payload
  }
}

/**
 * 从十六进制字符串转换为字节数组
 * @param hex 十六进制字符串
 * @returns 字节数组
 */
export function hexToBytes(hex: string): number[] {
  const bytes = []
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substr(i, 2), 16)
    if (!isNaN(byte)) {
      bytes.push(byte)
    }
  }
  return bytes
}

/**
 * 从字节数组转换为十六进制字符串
 * @param bytes 字节数组
 * @returns 十六进制字符串
 */
export function bytesToHex(bytes: number[]): string {
  return bytes
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

// 提取功率值的数组
export function extractPowerValues(hexString: string): number[] {
  const cleanHex = hexString.replace(/\s/g, '')
  const bytes: number[] = []
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.substring(i, i + 2), 16))
  }
  const result: number[] = []
  // 提取每个PID后面的功率值
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      result.push(bytes[i + 1]) // 提取功率值
    }
  }
  return result
}

export function normalizeHex(input: string) {
  return input.replace(/\s+/g, '').toUpperCase()
}

// 协议控制字 16进制
export function decodeControlWord(hex: string) {
  const value = parseInt(hex, 16)
  const messageId = value & 0xff
  const pad = (val: number, size: number) => val.toString(16).toUpperCase().padStart(size, '0')
  return {
    hex,
    value,
    protocolType: (value >>> 24) & 0xff,
    protocolVersion: (value >>> 16) & 0xff,
    rs485Flag: (value >>> 13) & 0x01,
    uploadFlag: (value >>> 12) & 0x01,
    messageCategory: (value >>> 8) & 0x0f,
    messageId,
    messageIdHex: `0x${pad(messageId, 2)}`
  }
}

// 计算长度函数（支持可控输出位数 + 支持直接输入数字作为值）
export function calculateDataLength(
  input: string | number, // 支持字符串（原逻辑）或数字（直接作为值）
  padLength: number = 4 // 默认改为 4 位（适合协议中总 length、newDataLength 等字段）
): {
  hexLength: string
  decimalLength: number
  byteCount: number
  dataArray: number[]
} {
  let byteCount: number
  let dataArray: number[] = []
  if (typeof input === 'number') {
    // 直接输入数字：视为值本身（可用于总 length、antMask、位长度等）
    byteCount = input
  } else {
    // 原字符串逻辑
    const cleanHex = input.replace(/\s/g, '')
    if (!/^[0-9A-Fa-f]+$/.test(cleanHex)) {
      throw new Error('无效的十六进制字符串')
    }
    if (cleanHex.length % 2 !== 0) {
      throw new Error('十六进制字符串长度必须为偶数')
    }
    byteCount = cleanHex.length / 2
    // 转换为字节数组（仅字符串输入需要）
    for (let i = 0; i < cleanHex.length; i += 2) {
      dataArray.push(parseInt(cleanHex.substring(i, i + 2), 16))
    }
  }

  // 十六进制长度（大端格式，可控位数）
  const hexLength = byteCount.toString(16).toUpperCase().padStart(padLength, '0')

  return {
    hexLength,
    decimalLength: byteCount,
    byteCount,
    dataArray
  }
}

/**
 * 根据匹配数据（十六进制字符串）
 * 计算协议中的「匹配数据位长度」字段
 *
 * 规则：
 * - 1 个 hex 字符 = 4 bit
 * - 协议字段 = bit 数，以十六进制表示
 *
 * @param matchHex 匹配数据内容（如 EPC / TID）
 */
export function calcMatchBitLength(matchHex: string): {
  bitLength: number
  hexField: string
} {
  const clean = matchHex.replace(/\s+/g, '').toUpperCase()
  if (!/^[0-9A-F]+$/.test(clean)) {
    throw new Error('匹配数据不是有效的十六进制字符串')
  }
  // 1 hex = 4 bit
  const bitLength = clean.length * 4
  // 协议字段：bit 长度，用 hex 表示（至少 2 位）
  const hexField = bitLength.toString(16).toUpperCase().padStart(2, '0')
  return {
    bitLength, // 实际 bit 数（96）
    hexField // 协议字段（"60"）
  }
}

//天线转 16 进制
export function antsToHexMask(ants: number[]): string {
  let mask = 0
  for (const ant of ants) {
    if (ant < 1 || ant > 32) {
      throw new Error(`Invalid antenna index: ${ant}`)
    }
    mask |= 1 << (ant - 1)
  }
  return mask.toString(16).padStart(8, '0').toUpperCase()
}

/**
 * PID定义
 */
const RFID_PID = {
  RSSI: 0x01,
  READ_RESULT: 0x02,
  TID_DATA: 0x03,
  CURRENT_FREQUENCY: 0x08,
  TAG_PHASE: 0x09
} as const

/**
 * RFID标签读取消息类型
 */
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

/**
 * 解析RFID标签读取消息（可传整帧或payload）
 * @param hexString 十六进制字符串消息
 * @returns 解析后的消息对象，无法解析时返回 null
 */
export function parseEPCMessage(hexString: string): IRFIDTagReadMessage | null {
  const cleanHex = normalizeHex(hexString)
  if (!cleanHex || !/^[0-9A-F]+$/.test(cleanHex)) {
    return null
  }

  const message: Partial<IRFIDTagReadMessage> = {
    rawMessage: cleanHex
  }

  let payloadHex = cleanHex
  if (cleanHex.startsWith('5A') && cleanHex.length >= 14) {
    const lengthHex = cleanHex.slice(10, 14)
    const payloadLength = parseInt(lengthHex, 16)
    const payloadEnd = 14 + payloadLength * 2
    if (!Number.isNaN(payloadLength)) {
      if (payloadEnd <= cleanHex.length) {
        payloadHex = cleanHex.slice(14, payloadEnd)
      } else {
        payloadHex = cleanHex.slice(14)
      }
    }
  }

  let index = 0
  const read = (chars: number) => {
    if (index + chars > payloadHex.length) {
      return null
    }
    const value = payloadHex.slice(index, index + chars)
    index += chars
    return value
  }
  const canRead = (chars: number) => index + chars <= payloadHex.length

  const minTailChars = 4 + 2
  let epcLengthHex = payloadHex.slice(0, 4)
  let epcLength = parseInt(epcLengthHex, 16)
  let headerChars = 4
  const twoByteValid =
    payloadHex.length >= 4 + minTailChars &&
    !Number.isNaN(epcLength) &&
    epcLength * 2 + headerChars + minTailChars <= payloadHex.length

  if (!twoByteValid) {
    const epcLengthHex1 = payloadHex.slice(0, 2)
    const epcLength1 = parseInt(epcLengthHex1, 16)
    if (
      payloadHex.length >= 2 + minTailChars &&
      !Number.isNaN(epcLength1) &&
      epcLength1 * 2 + 2 + minTailChars <= payloadHex.length
    ) {
      epcLengthHex = epcLengthHex1
      epcLength = epcLength1
      headerChars = 2
    }
  }

  if (Number.isNaN(epcLength) || epcLength * 2 + headerChars + minTailChars > payloadHex.length) {
    return null
  }

  index = headerChars
  message.epcLength = epcLength

  const epcHex = read(epcLength * 2)
  const pcHex = read(4)
  const antHex = read(2)
  if (epcHex === null || pcHex === null || antHex === null) {
    return null
  }
  message.epc = epcHex
  message.pcValue = pcHex
  message.antennaId = parseInt(antHex, 16)

  while (index < payloadHex.length) {
    if (!canRead(2)) {
      break
    }
    const pidHex = read(2)
    if (!pidHex) {
      break
    }
    const pid = parseInt(pidHex, 16)

    switch (pid) {
      case RFID_PID.RSSI: {
        if (!canRead(2)) {
          index = payloadHex.length
          break
        }
        const rssiHex = read(2)
        if (!rssiHex) {
          index = payloadHex.length
          break
        }
        message.rssi = {
          pid,
          value: parseInt(rssiHex, 16)
        }
        break
      }
      case RFID_PID.READ_RESULT: {
        if (!canRead(2)) {
          index = payloadHex.length
          break
        }
        const resultHex = read(2)
        if (!resultHex) {
          index = payloadHex.length
          break
        }
        message.readResult = {
          pid,
          success: parseInt(resultHex, 16) === 0x00
        }
        break
      }
      case RFID_PID.TID_DATA: {
        if (!canRead(4)) {
          index = payloadHex.length
          break
        }
        const tidLengthHex = read(4)
        if (!tidLengthHex) {
          index = payloadHex.length
          break
        }
        const tidLength = parseInt(tidLengthHex, 16)
        if (!canRead(tidLength * 2)) {
          index = payloadHex.length
          break
        }
        const tidData = read(tidLength * 2)
        if (!tidData) {
          index = payloadHex.length
          break
        }
        message.tidData = {
          pid,
          length: tidLength,
          data: tidData
        }
        break
      }
      case RFID_PID.CURRENT_FREQUENCY: {
        const remaining = payloadHex.length - index
        if (remaining < 6) {
          index = payloadHex.length
          break
        }
        let freqChars = 8
        if (remaining >= 6) {
          if (remaining < 8) {
            freqChars = 6
          } else {
            const nextPidHex = payloadHex.slice(index + 6, index + 8)
            const nextPid = parseInt(nextPidHex, 16)
            const knownPids = [
              RFID_PID.RSSI,
              RFID_PID.READ_RESULT,
              RFID_PID.TID_DATA,
              RFID_PID.CURRENT_FREQUENCY,
              RFID_PID.TAG_PHASE
            ]
            // @ts-ignore
            if (knownPids.includes(nextPid)) {
              freqChars = 6
            }
          }
        }
        if (!canRead(freqChars)) {
          index = payloadHex.length
          break
        }
        const freqHex = read(freqChars)
        if (!freqHex) {
          index = payloadHex.length
          break
        }
        const freqInt = parseInt(freqHex, 16)
        message.currentFrequency = {
          pid,
          frequency: freqInt / 1000.0
        }
        break
      }
      case RFID_PID.TAG_PHASE: {
        if (!canRead(2)) {
          index = payloadHex.length
          break
        }
        const phaseHex = read(2)
        if (!phaseHex) {
          index = payloadHex.length
          break
        }
        message.tagPhase = {
          pid,
          phase: parseInt(phaseHex, 16)
        }
        break
      }
      default:
        if (canRead(2)) {
          index += 2
        } else {
          index = payloadHex.length
        }
        break
    }
  }

  return message as IRFIDTagReadMessage
}

export function parseFrame(input: string) {
  const hex = normalizeHex(input)
  if (!hex) throw new Error('返回内容为空')
  if (hex.length % 2 !== 0) throw new Error('HEX 长度不是偶数')
  const minBytes = 1 + 4 + 2 + 2
  if (hex.length < minBytes * 2) throw new Error('数据长度不足')

  const frameHead = hex.slice(0, 2)
  if (frameHead !== '5A') throw new Error(`帧头错误: ${frameHead}`)

  const controlHex = hex.slice(2, 10)
  const lengthHex = hex.slice(10, 14)
  const payloadLength = parseInt(lengthHex, 16)
  const payloadStart = 14
  const payloadEnd = payloadStart + payloadLength * 2
  const crcEnd = payloadEnd + 4
  if (hex.length < crcEnd) throw new Error('长度字段与实际数据不一致')

  const payloadHex = hex.slice(payloadStart, payloadEnd)
  const crc = hex.slice(payloadEnd, crcEnd)
  const controlWord = decodeControlWord(controlHex)
  const base = {
    frameHead,
    controlWord,
    mid: controlWord.messageIdHex,
    length: { hex: lengthHex, value: payloadLength },
    crc
  } as Record<string, unknown>

  base.payload = payloadHex

  return base
}

const padHex = (value: number, length: number) =>
  value.toString(16).toUpperCase().padStart(length, '0')

export const crc16Ccitt = (hex: string) => {
  const clean = normalizeHex(hex)
  let crc = 0x0000
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16)
    crc ^= (byte << 8)
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xffff
    }
  }
  return padHex(crc, 4)
}

/**
 * UHF RFID 读写器协议 - 协议控制字生成工具（TypeScript）
 *
 * 根据传入的字段参数，计算出 32 位协议控制字（big-endian 字节序）
 * 支持返回：
 *   - 32 位整数（number）
 *   - 十六进制字符串（如 "00010110"）
 *   - Uint8Array（4 字节，big-endian，适合直接发送）
 */

export interface ControlWordParams {
  /** 协议类型号 (bit 31-24)，默认 0（UHF RFID 读写器协议） */
  protocolType?: number;       // 0 | 15 等，范围 0~255
  /** 协议版本号 (bit 23-16)，默认 1（即 0x01） */
  protocolVersion?: number;    // 通常为 1
  /** RS485 标志位 (bit 13)，0 或 1 */
  rs485Flag?: 0 | 1;
  /** 读写器主动上传标志位 (bit 12)，0 或 1 */
  uploadFlag?: 0 | 1;
  /** 消息类别号 (bit 11-8)，0~5 常用 */
  messageCategory: number;     // 必须传入，0~15（协议中 0~5 有定义）
  /** 消息 ID (bit 7-0)，0x00~0xFF */
  messageId: number;           // 必须传入，0~255
}

/**
 * 生成协议控制字
 * @param params 参数对象
 * @returns 对象包含多种格式的结果
 */
export function generateControlWord(params: ControlWordParams): {
  value: number;                    // 32 位整数
  hex: string;                      // 8 位十六进制字符串（大写，无前缀）
  bytes: Uint8Array;                // 4 字节数组（big-endian）
  byteString: string;               // 字节序列空格分隔（如 "00 01 01 10"）
} {
  const {
    protocolType = 0,
    protocolVersion = 1,
    rs485Flag = 0,
    uploadFlag = 0,
    messageCategory = 2,
    messageId,
  } = params;

  // 保留位固定为 0，无需参数

  // 计算 32 位整数
  const value =
    (protocolType << 24) |
    (protocolVersion << 16) |
    (rs485Flag << 13) |
    (uploadFlag << 12) |
    (messageCategory << 8) |
    messageId;

  // 转为 8 位十六进制字符串（补零）
  const hex = value.toString(16).toUpperCase().padStart(8, '0');

  // 转为 big-endian 字节数组
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value, false); // false 表示 big-endian

  // 字节序列字符串（常用于调试或日志）
  const byteString = Array.from(bytes)
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');

  return { value, hex, bytes, byteString };
}

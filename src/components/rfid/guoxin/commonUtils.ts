export const RFID_BRAND = {
  OLD: 'OLD',
  GUOXIN: 'GUOXIN'
}

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

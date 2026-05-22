export function normalizeHex(input: string) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

export function toHex(value: number, width = 2) {
  return Number(value).toString(16).toUpperCase().padStart(width, '0')
}

export interface LuodanFrame {
  head: string
  length: number
  address: number
  command: number
  payload: string
  checksum: number
  rawFrame: string
}

export interface LuodanPhaseValue {
  raw: number
  hex: string
}

export interface LuodanTagReadMessage {
  epc: string
  pc: string
  antennaId: number
  frequencyParameter: number
  frequencyMHz: number | null
  rssi: {
    raw: number
    value: number
  }
  phase?: LuodanPhaseValue
  rawFrame: string
}

export type LuodanInventoryMessage =
  | {
    type: 'tag'
    address: number
    command: number
    tag: LuodanTagReadMessage
    rawFrame: string
  }
  | {
    type: 'done'
    address: number
    command: number
    antennaId: number
    readRate: number
    totalRead: number
    rawFrame: string
  }
  | {
    type: 'error'
    address: number
    command: number
    errorCode: number
    message: string
    rawFrame: string
  }

const FRAME_HEAD = 'A0'
const HEADER_BYTES = 2
const CHECKSUM_BYTES = 1
const MIN_FRAME_CHARS = 10
const ERROR_MESSAGES: Record<number, string> = {
  0x01: '命令执行失败',
  0x02: 'CRC 校验错误',
  0x03: '参数错误',
  0x04: '读写器忙',
  0x10: '命令成功完成',
  0x11: '命令执行失败',
  0x20: 'CPU复位错误',
  0x22: '天线未连接',
  0x23: '写Flash错误',
  0x24: '读Flash错误',
  0x25: '设置发射功率错误',
  0x31: '盘存标签错误',
  0x32: '读标签错误',
  0x33: '写标签错误',
  0x34: '锁定标签错误',
  0x35: '灭活标签错误',
  0x36: '无可操作标签错误',
  0x37: '成功盘存但访问失败',
  0x38: '缓存为空',
  0x3c: 'NXP芯片自定义指令失败',
  0x40: '访问标签错误或访问密码错误',
  0x41: '无效的参数',
  0x42: 'wordCnt参数超过规定长度',
  0x43: 'MemBank参数超出范围',
  0x44: 'Lock数据区参数超出范围',
  0x45: 'LockType参数超出范围',
  0x46: '读写器地址无效',
  0x47: '天线号超出范围',
  0x48: '输出功率参数超出范围',
  0x49: '射频规范区域参数超出范围',
  0x4a: '波特率参数超出范围',
  0x4b: '蜂鸣器设置参数超出范围',
  0x4c: 'EPC匹配长度越界',
  0x4d: 'EPC匹配长度错误',
  0x4e: 'EPC匹配参数超出范围',
  0x4f: '频率范围设置参数错误',
  0x50: '无法接收标签的RN16',
  0x51: 'DRM设置参数错误',
  0x52: 'PLL不能锁定',
  0x53: '射频芯片无响应',
  0x54: '输出达不到指定的输出功率',
  0x55: '版权认证未通过',
  0x56: '频谱规范设置错误'
}

function assertByte(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label}必须是 0~255 的整数`)
  }
}

function hexToBytes(hex: string) {
  const clean = normalizeHex(hex)
  if (!clean) {
    return []
  }
  if (!/^[0-9A-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('HEX 必须是偶数位十六进制字符')
  }

  const bytes: number[] = []
  for (let index = 0; index < clean.length; index += 2) {
    bytes.push(parseInt(clean.slice(index, index + 2), 16))
  }

  return bytes
}

function bytesToHex(bytes: number[]) {
  return bytes.map((byte) => toHex(byte)).join('')
}

function calculateChecksum(bytes: number[]) {
  const sum = bytes.reduce((total, byte) => (total + byte) & 0xff, 0)
  return ((~sum + 1) & 0xff)
}

function readUint(hex: string) {
  if (!hex) {
    return 0
  }
  return parseInt(hex, 16)
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeRssiValue(raw: number) {
  return raw & 0x7f
}

function resolveAntennaId(freqAnt: number, rssiRaw: number) {
  const baseAntenna = (freqAnt & 0x03) + 1
  return (rssiRaw & 0x80) === 0 ? baseAntenna : baseAntenna + 4
}

export function resolveLuodanFrequencyMHz(frequencyParameter: number) {
  const parsed = Number(frequencyParameter)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0x3b) {
    return null
  }

  if (parsed <= 0x06) {
    return roundTo(865 + parsed * 0.5, 2)
  }

  return roundTo(902 + (parsed - 0x07) * 0.5, 2)
}

function formatErrorCode(errorCode: number) {
  return ERROR_MESSAGES[errorCode] ?? `未知错误码 0x${toHex(errorCode)}`
}

export function describeLuodanStatusCode(statusCode: number) {
  return formatErrorCode(statusCode)
}

export function buildLuodanFrame(command: number, payload = '', address = 0xff) {
  assertByte(command, '命令码')
  assertByte(address, '读写器地址')

  const payloadBytes = hexToBytes(payload)
  const length = HEADER_BYTES + payloadBytes.length + CHECKSUM_BYTES
  assertByte(length, '长度')

  const bodyBytes = [length, address, command, ...payloadBytes]
  const checksum = calculateChecksum([0xa0, ...bodyBytes])
  return `${FRAME_HEAD}${bytesToHex([...bodyBytes, checksum])}`
}

export function splitLuodanFrames(buffer: string, chunk = '') {
  let pending = normalizeHex(`${buffer}${chunk}`)
  return {
    frames: extractFrames(),
    buffer: pending
  }

  function extractFrames() {
    const frames: string[] = []

    while (pending.length) {
      const headIndex = pending.indexOf(FRAME_HEAD)
      if (headIndex === -1) {
        pending = ''
        break
      }

      if (headIndex > 0) {
        pending = pending.slice(headIndex)
      }

      if (pending.length < MIN_FRAME_CHARS) {
        break
      }

      const length = parseInt(pending.slice(2, 4), 16)
      if (Number.isNaN(length) || length < 3) {
        pending = pending.slice(2)
        continue
      }

      const frameChars = 4 + length * 2
      if (pending.length < frameChars) {
        break
      }

      frames.push(pending.slice(0, frameChars))
      pending = pending.slice(frameChars)
    }

    return frames
  }
}

export function parseLuodanFrame(input: string): LuodanFrame {
  const hex = normalizeHex(input)
  if (!hex) {
    throw new Error('返回内容为空')
  }
  if (!/^[0-9A-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('HEX 必须是偶数位十六进制字符')
  }
  if (hex.length < MIN_FRAME_CHARS) {
    throw new Error('数据长度不足')
  }
  if (hex.slice(0, 2) !== FRAME_HEAD) {
    throw new Error(`帧头错误: ${hex.slice(0, 2)}`)
  }

  const length = readUint(hex.slice(2, 4))
  const expectedChars = 4 + length * 2
  if (length < 3 || hex.length < expectedChars) {
    throw new Error('长度字段与实际数据不一致')
  }

  const rawFrame = hex.slice(0, expectedChars)
  const bytes = hexToBytes(rawFrame.slice(2))
  const checksum = bytes[bytes.length - 1]
  const expectedChecksum = calculateChecksum(hexToBytes(rawFrame.slice(0, -2)))
  if (checksum !== expectedChecksum) {
    throw new Error(`校验和错误: 期望 ${toHex(expectedChecksum)} 实际 ${toHex(checksum)}`)
  }

  return {
    head: FRAME_HEAD,
    length,
    address: bytes[1],
    command: bytes[2],
    payload: rawFrame.slice(8, -2),
    checksum,
    rawFrame
  }
}

export function parseLuodanInventoryMessage(
  input: string,
  options: { phaseEnabled?: boolean } = {}
): LuodanInventoryMessage | null {
  const frame = parseLuodanFrame(input)
  if (frame.command !== 0x8b && frame.command !== 0x89 && frame.command !== 0x8a) {
    return null
  }

  const payload = frame.payload
  const payloadBytes = payload.length / 2

  if (payloadBytes === 1) {
    const errorCode = readUint(payload)
    return {
      type: 'error',
      address: frame.address,
      command: frame.command,
      errorCode,
      message: formatErrorCode(errorCode),
      rawFrame: frame.rawFrame
    }
  }

  if (payloadBytes === 7) {
    const antIdRaw = readUint(payload.slice(0, 2))
    return {
      type: 'done',
      address: frame.address,
      command: frame.command,
      antennaId: antIdRaw + 1,
      readRate: readUint(payload.slice(2, 6)),
      totalRead: readUint(payload.slice(6, 14)),
      rawFrame: frame.rawFrame
    }
  }

  const phaseChars = options.phaseEnabled ? 4 : 0
  const fixedTailChars = 2 + phaseChars
  if (payload.length < 2 + 4 + fixedTailChars) {
    return null
  }

  const freqAnt = readUint(payload.slice(0, 2))
  const pc = payload.slice(2, 6)
  const epcEnd = payload.length - fixedTailChars
  if (epcEnd < 6) {
    return null
  }

  const epc = payload.slice(6, epcEnd)
  const rssiRaw = readUint(payload.slice(epcEnd, epcEnd + 2))
  const phaseHex = options.phaseEnabled
    ? payload.slice(epcEnd + 2, epcEnd + 6)
    : ''
  const phaseRaw = phaseHex ? readUint(phaseHex) : null
  const frequencyParameter = freqAnt >> 2

  return {
    type: 'tag',
    address: frame.address,
    command: frame.command,
    rawFrame: frame.rawFrame,
    tag: {
      epc,
      pc,
      antennaId: resolveAntennaId(freqAnt, rssiRaw),
      frequencyParameter,
      frequencyMHz: resolveLuodanFrequencyMHz(frequencyParameter),
      rssi: {
        raw: rssiRaw,
        value: normalizeRssiValue(rssiRaw)
      },
      ...(phaseRaw === null
        ? {}
        : {
          phase: {
            raw: phaseRaw,
            hex: phaseHex
          }
        }),
      rawFrame: frame.rawFrame
    }
  }
}

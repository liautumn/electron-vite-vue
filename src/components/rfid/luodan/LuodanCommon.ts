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
  degrees: number
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
const PHASE_FULL_SCALE = 4096
const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458
const ERROR_MESSAGES: Record<number, string> = {
  0x01: '命令执行失败',
  0x02: 'CRC 校验错误',
  0x03: '参数错误',
  0x04: '读写器忙',
  0x22: '天线未连接'
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
            hex: phaseHex,
            degrees: roundTo((phaseRaw / PHASE_FULL_SCALE) * 360, 2)
          }
        }),
      rawFrame: frame.rawFrame
    }
  }
}

export function estimatePhaseDistanceMeters(phaseRaw: number, frequencyMHz = 915) {
  const parsedPhase = Number(phaseRaw)
  const parsedFrequency = Number(frequencyMHz)
  if (!Number.isFinite(parsedPhase) || !Number.isFinite(parsedFrequency) || parsedFrequency <= 0) {
    return null
  }

  const normalizedPhase = ((parsedPhase % PHASE_FULL_SCALE) + PHASE_FULL_SCALE) % PHASE_FULL_SCALE
  const wavelength = SPEED_OF_LIGHT_METERS_PER_SECOND / (parsedFrequency * 1_000_000)
  return roundTo((normalizedPhase / PHASE_FULL_SCALE) * (wavelength / 2), 4)
}

export function estimatePhaseDistanceCm(phaseRaw: number, frequencyMHz = 915) {
  const meters = estimatePhaseDistanceMeters(phaseRaw, frequencyMHz)
  return meters === null ? null : roundTo(meters * 100, 2)
}

export function estimateRelativePhaseDistanceCm(
  currentPhaseRaw: number,
  baselinePhaseRaw: number,
  frequencyMHz = 915
) {
  const parsedCurrentPhase = Number(currentPhaseRaw)
  const parsedBaselinePhase = Number(baselinePhaseRaw)
  const parsedFrequency = Number(frequencyMHz)
  if (
    !Number.isFinite(parsedCurrentPhase) ||
    !Number.isFinite(parsedBaselinePhase) ||
    !Number.isFinite(parsedFrequency) ||
    parsedFrequency <= 0
  ) {
    return null
  }

  const rawDelta = parsedCurrentPhase - parsedBaselinePhase
  const wrappedDelta = ((rawDelta + PHASE_FULL_SCALE / 2) % PHASE_FULL_SCALE + PHASE_FULL_SCALE) %
    PHASE_FULL_SCALE -
    PHASE_FULL_SCALE / 2
  const wavelength = SPEED_OF_LIGHT_METERS_PER_SECOND / (parsedFrequency * 1_000_000)
  return roundTo((wrappedDelta / PHASE_FULL_SCALE) * (wavelength / 2) * 100, 2)
}

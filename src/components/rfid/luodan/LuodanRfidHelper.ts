import {
  buildLuodanFrame,
  describeLuodanStatusCode,
  normalizeHex,
  parseLuodanFrame,
  toHex,
  type LuodanInventoryMessage
} from './LuodanCommon'
import { luodanDevice } from './LuodanDevice'
import { readEPCPhaseParseFrame } from './LuodanParseFrame'

export interface LuodanPhaseInventoryOptions {
  session?: number
  target?: number
  sl?: number
  repeat?: number
  powerSave?: number | null
  address?: number
  sessionId?: number
}

const COMMAND = {
  SET_ANTENNA_GROUP: 0x6c,
  GET_ANTENNA_GROUP: 0x6d,
  SET_BEEPER_MODE: 0x7a,
  SET_OUTPUT_POWER: 0x76,
  SET_FREQUENCY_REGION: 0x78,
  GET_OUTPUT_POWER_4_PORT: 0x77,
  GET_OUTPUT_POWER_8_PORT: 0x97,
  CUSTOMIZED_SESSION_TARGET_INVENTORY: 0x8b
} as const

const COMMAND_SUCCESS = 0x10
const POWER_COMMAND_TIMEOUT_MS = 3000
const FOUR_PORT_POWER_COUNT = 4
const EIGHT_PORT_POWER_COUNT = 8
const MAX_LOGICAL_ANTENNA_COUNT = 16
const FIXED_FREQUENCY_SPACE_500_KHZ = 0x32
const DEFAULT_HOPPING_FREQUENCY_REGION = 0x03
const DEFAULT_HOPPING_START_FREQ = 0x1e
const DEFAULT_HOPPING_END_FREQ = 0x3b

function normalizeByte(value: unknown, fallback: number, label: string) {
  const parsed = Number(value)
  const nextValue = Number.isInteger(parsed) ? parsed : fallback
  if (nextValue < 0 || nextValue > 0xff) {
    throw new Error(`${label}必须是 0~255 的整数`)
  }
  return nextValue
}

function normalizeRequiredInteger(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须是 ${min}~${max} 的整数`)
  }
  return parsed
}

function buildUniformPowerPayload(powerDbm: number) {
  return toHex(normalizeRequiredInteger(powerDbm, 0, 33, '功率'))
}

function normalizeFrequencyKHz(frequencyMHz: unknown) {
  const parsed = Number(frequencyMHz)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('定频频率必须是大于 0 的数字')
  }

  const frequencyKHz = Math.round(parsed * 1000)
  if (!Number.isInteger(frequencyKHz) || frequencyKHz <= 0 || frequencyKHz > 0xffffff) {
    throw new Error('定频频率超出协议可编码范围')
  }

  return frequencyKHz
}

function resolvePowerFrameAntennaCount(antennaCount: number) {
  return antennaCount > FOUR_PORT_POWER_COUNT
    ? EIGHT_PORT_POWER_COUNT
    : FOUR_PORT_POWER_COUNT
}

function resolveAntennaGroupIndex(antennaId: number) {
  return Math.floor((antennaId - 1) / EIGHT_PORT_POWER_COUNT)
}

function resolveGroupAntennaId(antennaId: number) {
  return ((antennaId - 1) % EIGHT_PORT_POWER_COUNT) + 1
}

function buildAntennaPowerLevels(
  antennaId: number,
  powerDbm: number,
  currentPowerLevels: number[],
  antennaCount: number
) {
  const normalizedAntennaCount = normalizeRequiredInteger(
    antennaCount,
    1,
    MAX_LOGICAL_ANTENNA_COUNT,
    '天线数'
  )
  const normalizedAntennaId = normalizeRequiredInteger(
    antennaId,
    1,
    normalizedAntennaCount,
    '天线号'
  )
  const normalizedPower = normalizeRequiredInteger(powerDbm, 0, 33, '功率')
  const groupIndex = resolveAntennaGroupIndex(normalizedAntennaId)
  const groupStartIndex = groupIndex * EIGHT_PORT_POWER_COUNT
  const groupAntennaId = resolveGroupAntennaId(normalizedAntennaId)
  const powerFrameAntennaCount = groupIndex > 0
    ? EIGHT_PORT_POWER_COUNT
    : resolvePowerFrameAntennaCount(normalizedAntennaCount)

  const groupPowerLevels = Array.from({ length: powerFrameAntennaCount }, (_, index) => {
    const logicalIndex = groupStartIndex + index
    const fallbackPower = currentPowerLevels[logicalIndex] ?? normalizedPower
    return index === groupAntennaId - 1
      ? normalizedPower
      : normalizeRequiredInteger(fallbackPower, 0, 33, `天线${index + 1}功率`)
  })

  const nextPowerLevels = Array.from({ length: normalizedAntennaCount }, (_, index) =>
    currentPowerLevels[index] ?? normalizedPower
  )

  groupPowerLevels.forEach((power, index) => {
    const logicalIndex = groupStartIndex + index
    if (logicalIndex < nextPowerLevels.length) {
      nextPowerLevels[logicalIndex] = power
    }
  })

  return {
    groupIndex,
    groupPowerLevels,
    powerLevels: nextPowerLevels
  }
}

function parsePowerLevelsPayload(payload: string) {
  const data = normalizeHex(payload)
  if (!data) {
    return []
  }

  return Array.from({ length: data.length / 2 }, (_, index) =>
    parseInt(data.slice(index * 2, index * 2 + 2), 16)
  )
}

function waitForCommandResponse<T>(
  command: number,
  parsePayload: (payload: string) => T,
  send: () => void,
  sessionId?: number,
  timeoutMs = POWER_COMMAND_TIMEOUT_MS
) {
  const targetSessionId = sessionId ?? luodanDevice.currentSessionId

  return new Promise<T>((resolve, reject) => {
    let completed = false
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`等待 0x${toHex(command)} 响应超时`))
    }, timeoutMs)

    const cleanup = () => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      luodanDevice.off(handler, targetSessionId)
    }

    const handler = (rawData: string) => {
      try {
        const frame = parseLuodanFrame(rawData)
        if (frame.command !== command) {
          return
        }

        const result = parsePayload(frame.payload)
        cleanup()
        resolve(result)
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    luodanDevice.on(handler, targetSessionId)

    try {
      send()
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function sendFrame(frame: string, sessionId?: number) {
  luodanDevice.sendMessageNew(frame, sessionId)
}

function ensureSuccessStatus(payload: string) {
  const statusCode = parseInt(normalizeHex(payload), 16)
  if (statusCode !== COMMAND_SUCCESS) {
    throw new Error(describeLuodanStatusCode(statusCode))
  }
}

export async function setAntennaGroup(
  groupIndex: number,
  options: { address?: number, sessionId?: number } = {}
) {
  const normalizedGroupIndex = normalizeRequiredInteger(groupIndex, 0, 1, '天线组')
  const frame = buildLuodanFrame(
    COMMAND.SET_ANTENNA_GROUP,
    toHex(normalizedGroupIndex),
    normalizeByte(options.address, 0xff, '读写器地址')
  )

  await waitForCommandResponse(
    COMMAND.SET_ANTENNA_GROUP,
    ensureSuccessStatus,
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )

  return frame
}

export async function getAntennaGroup(
  options: { address?: number, sessionId?: number } = {}
) {
  const frame = buildLuodanFrame(
    COMMAND.GET_ANTENNA_GROUP,
    '',
    normalizeByte(options.address, 0xff, '读写器地址')
  )

  return waitForCommandResponse(
    COMMAND.GET_ANTENNA_GROUP,
    (payload) => normalizeRequiredInteger(parseInt(normalizeHex(payload), 16), 0, 1, '当前天线组'),
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )
}

export async function setBeeperMode(
  mode: number,
  options: { address?: number, sessionId?: number } = {}
) {
  const normalizedMode = normalizeRequiredInteger(mode, 0, 2, '蜂鸣器模式')
  const frame = buildLuodanFrame(
    COMMAND.SET_BEEPER_MODE,
    toHex(normalizedMode),
    normalizeByte(options.address, 0xff, '读写器地址')
  )

  await waitForCommandResponse(
    COMMAND.SET_BEEPER_MODE,
    ensureSuccessStatus,
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )

  return frame
}

export function buildFixedFrequencyFrame(frequencyMHz: number, address = 0xff) {
  const frequencyKHz = normalizeFrequencyKHz(frequencyMHz)
  const payload = [
    toHex(0x04),
    toHex(FIXED_FREQUENCY_SPACE_500_KHZ),
    toHex(0x01),
    toHex(frequencyKHz, 6)
  ].join('')

  return buildLuodanFrame(
    COMMAND.SET_FREQUENCY_REGION,
    payload,
    normalizeByte(address, 0xff, '读写器地址')
  )
}

export async function setFixedFrequency(
  frequencyMHz: number,
  options: { address?: number, sessionId?: number } = {}
) {
  const frame = buildFixedFrequencyFrame(frequencyMHz, options.address)

  await waitForCommandResponse(
    COMMAND.SET_FREQUENCY_REGION,
    ensureSuccessStatus,
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )

  return frame
}

export function buildHoppingFrequencyFrame(address = 0xff) {
  const payload = [
    toHex(DEFAULT_HOPPING_FREQUENCY_REGION),
    toHex(DEFAULT_HOPPING_START_FREQ),
    toHex(DEFAULT_HOPPING_END_FREQ)
  ].join('')

  return buildLuodanFrame(
    COMMAND.SET_FREQUENCY_REGION,
    payload,
    normalizeByte(address, 0xff, '读写器地址')
  )
}

export async function setHoppingFrequency(
  options: { address?: number, sessionId?: number } = {}
) {
  const frame = buildHoppingFrequencyFrame(options.address)

  await waitForCommandResponse(
    COMMAND.SET_FREQUENCY_REGION,
    ensureSuccessStatus,
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )

  return frame
}

export function buildPhaseInventoryFrame(options: LuodanPhaseInventoryOptions = {}) {
  const session = normalizeByte(options.session, 0x01, 'Session')
  const target = normalizeByte(options.target, 0x00, 'Target')
  const sl = normalizeByte(options.sl, 0x00, 'SL')
  const repeat = normalizeByte(options.repeat, 0x01, 'Repeat')
  const address = normalizeByte(options.address, 0xff, '读写器地址')

  const payloadBytes = [session, target, sl, 0x01]
  if (options.powerSave !== null && options.powerSave !== undefined) {
    payloadBytes.push(normalizeByte(options.powerSave, 0x00, 'PowerSave'))
  }
  payloadBytes.push(repeat)

  return buildLuodanFrame(
    COMMAND.CUSTOMIZED_SESSION_TARGET_INVENTORY,
    payloadBytes.map((byte) => toHex(byte)).join(''),
    address
  )
}

export function readEPCPhaseContinuous(
  callback: (data: LuodanInventoryMessage) => void,
  options: LuodanPhaseInventoryOptions = {}
) {
  const frame = buildPhaseInventoryFrame(options)

  return readEPCPhaseParseFrame(
    callback,
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )
}

export function buildPermanentOutputPowerFrame(
  powerLevels: number[] | number,
  address = 0xff
) {
  const normalizedAddress = normalizeByte(address, 0xff, '读写器地址')
  const payload = Array.isArray(powerLevels)
    ? (() => {
      if (![1, FOUR_PORT_POWER_COUNT, EIGHT_PORT_POWER_COUNT].includes(powerLevels.length)) {
        throw new Error('功率数组长度必须是 1、4 或 8')
      }
      return powerLevels
        .map((power, index) => toHex(normalizeRequiredInteger(power, 0, 33, `天线${index + 1}功率`)))
        .join('')
    })()
    : buildUniformPowerPayload(powerLevels)

  return buildLuodanFrame(COMMAND.SET_OUTPUT_POWER, payload, normalizedAddress)
}

export async function setPermanentOutputPower(
  powerLevels: number[] | number,
  options: { address?: number, sessionId?: number } = {}
) {
  const frame = buildPermanentOutputPowerFrame(powerLevels, options.address)

  await waitForCommandResponse(
    COMMAND.SET_OUTPUT_POWER,
    ensureSuccessStatus,
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )

  return frame
}

export async function readPermanentOutputPower(
  options: { address?: number, sessionId?: number, antennaCount?: number } = {}
) {
  const normalizedAntennaCount = normalizeRequiredInteger(
    options.antennaCount ?? 4,
    1,
    MAX_LOGICAL_ANTENNA_COUNT,
    '天线数'
  )

  if (normalizedAntennaCount > EIGHT_PORT_POWER_COUNT) {
    let originalGroup: number | null = null
    try {
      originalGroup = await getAntennaGroup(options)
    } catch {
      originalGroup = null
    }

    try {
      const powerGroups: number[][] = []
      for (let groupIndex = 0; groupIndex < 2; groupIndex += 1) {
        await setAntennaGroup(groupIndex, options)
        powerGroups.push(await readPermanentOutputPower({
          ...options,
          antennaCount: EIGHT_PORT_POWER_COUNT
        }))
      }

      return powerGroups.flat().slice(0, normalizedAntennaCount)
    } finally {
      if (originalGroup !== null) {
        try {
          await setAntennaGroup(originalGroup, options)
        } catch {
          // 恢复工作组失败不覆盖原始读功率结果。
        }
      }
    }
  }

  const powerFrameAntennaCount = resolvePowerFrameAntennaCount(normalizedAntennaCount)
  const command = powerFrameAntennaCount > FOUR_PORT_POWER_COUNT
    ? COMMAND.GET_OUTPUT_POWER_8_PORT
    : COMMAND.GET_OUTPUT_POWER_4_PORT
  const frame = buildLuodanFrame(command, '', normalizeByte(options.address, 0xff, '读写器地址'))

  return waitForCommandResponse(
    command,
    (payload) => {
      const powerLevels = parsePowerLevelsPayload(payload)
      if (powerLevels.length === 1) {
        return Array.from({ length: powerFrameAntennaCount }, () => powerLevels[0])
      }
      return powerLevels
    },
    () => sendFrame(frame, options.sessionId),
    options.sessionId
  )
}

export async function setAntennaPermanentOutputPower(
  options: {
    antennaId: number
    powerDbm: number
    currentPowerLevels: number[]
    antennaCount: number
    address?: number
    sessionId?: number
  }
) {
  const isGroupedReader = options.antennaCount > EIGHT_PORT_POWER_COUNT
  const nextPowerConfig = buildAntennaPowerLevels(
    options.antennaId,
    options.powerDbm,
    options.currentPowerLevels,
    options.antennaCount
  )

  let originalGroup: number | null = null
  if (isGroupedReader) {
    try {
      originalGroup = await getAntennaGroup({
        address: options.address,
        sessionId: options.sessionId
      })
    } catch {
      originalGroup = null
    }
  }

  try {
    if (isGroupedReader) {
      await setAntennaGroup(nextPowerConfig.groupIndex, {
        address: options.address,
        sessionId: options.sessionId
      })
    }

    const frame = await setPermanentOutputPower(nextPowerConfig.groupPowerLevels, {
      address: options.address,
      sessionId: options.sessionId
    })

    return {
      frame,
      groupIndex: nextPowerConfig.groupIndex,
      powerLevels: nextPowerConfig.powerLevels
    }
  } finally {
    if (originalGroup !== null && originalGroup !== nextPowerConfig.groupIndex) {
      try {
        await setAntennaGroup(originalGroup, {
          address: options.address,
          sessionId: options.sessionId
        })
      } catch {
        // 恢复工作组失败不覆盖原始写功率结果。
      }
    }
  }
}

export function sendRawLuodanHex(hex: string, sessionId?: number) {
  sendFrame(hex, sessionId)
}

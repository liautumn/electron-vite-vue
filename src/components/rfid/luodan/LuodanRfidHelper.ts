import {
  buildLuodanFrame,
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
  CUSTOMIZED_SESSION_TARGET_INVENTORY: 0x8b
} as const

function normalizeByte(value: unknown, fallback: number, label: string) {
  const parsed = Number(value)
  const nextValue = Number.isInteger(parsed) ? parsed : fallback
  if (nextValue < 0 || nextValue > 0xff) {
    throw new Error(`${label}必须是 0~255 的整数`)
  }
  return nextValue
}

function sendFrame(frame: string, sessionId?: number) {
  luodanDevice.sendMessageNew(frame, sessionId)
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

export function sendRawLuodanHex(hex: string, sessionId?: number) {
  sendFrame(hex, sessionId)
}

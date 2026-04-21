import { padSingleDevice } from './PadSingleDevice'
import {
  buildDisableHoldOpenCommand,
  buildEnableHoldOpenCommand,
  buildOpenLockCommand,
  buildQueryLockStatusCommand,
  normalizePadHex,
  parsePadVariableCommandResponse,
  requirePadHexPayload
} from './PadProtocol'

// 普通锁开锁：发送 8A，并等待对应地址的 8A 响应。
export async function openPadLock(
  boardAddress: number,
  lockAddress: number,
  timeout = 2000,
  sessionId?: number
) {
  const commandHex = buildOpenLockCommand(boardAddress, lockAddress)
  const frame = await padSingleDevice.requestFrame(
    () => padSingleDevice.sendHex(commandHex, sessionId),
    (item) =>
      item.header === '8A' &&
      item.boardAddress === boardAddress &&
      item.lockAddress === lockAddress,
    timeout,
    sessionId
  )

  return {
    commandHex,
    frame
  }
}

// 单锁状态查询：发送 80，并等待对应地址的 80 响应。
export async function queryPadLockStatus(
  boardAddress: number,
  lockAddress: number,
  timeout = 2000,
  sessionId?: number
) {
  const commandHex = buildQueryLockStatusCommand(boardAddress, lockAddress)
  const frame = await padSingleDevice.requestFrame(
    () => padSingleDevice.sendHex(commandHex, sessionId),
    (item) =>
      item.header === '80' &&
      item.boardAddress === boardAddress &&
      item.lockAddress === lockAddress,
    timeout,
    sessionId
  )

  return {
    commandHex,
    frame
  }
}

// 电磁锁开启长通电：先保留原始返回，再按 9A 规则尽量解析。
export async function enablePadLockKeepOpen(
  boardAddress: number,
  lockAddress: number,
  timeout = 2000,
  sessionId?: number
) {
  const commandHex = buildEnableHoldOpenCommand(boardAddress, lockAddress)
  const rawResponseHex = await padSingleDevice.requestRawResponse(
    () => padSingleDevice.sendHex(commandHex, sessionId),
    {
      timeout,
      optional: true
    },
    sessionId
  )

  return {
    commandHex,
    rawResponseHex,
    parsedResponse: parsePadVariableCommandResponse('9A', rawResponseHex)
  }
}

// 电磁锁关闭长通电：先保留原始返回，再按 9B 规则尽量解析。
export async function disablePadLockKeepOpen(
  boardAddress: number,
  lockAddress: number,
  timeout = 2000,
  sessionId?: number
) {
  const commandHex = buildDisableHoldOpenCommand(boardAddress, lockAddress)
  const rawResponseHex = await padSingleDevice.requestRawResponse(
    () => padSingleDevice.sendHex(commandHex, sessionId),
    {
      timeout,
      optional: true
    },
    sessionId
  )

  return {
    commandHex,
    rawResponseHex,
    parsedResponse: parsePadVariableCommandResponse('9B', rawResponseHex)
  }
}

// 自定义 HEX 直接透传到设备，主要用于联调和补测。
export async function sendPadRawHex(rawHex: string, sessionId?: number) {
  const commandHex = requirePadHexPayload(normalizePadHex(rawHex), '自定义 HEX')
  await padSingleDevice.sendHex(commandHex, sessionId)
  return commandHex
}

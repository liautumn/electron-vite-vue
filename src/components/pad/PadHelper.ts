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

export async function openPadLock(boardAddress: number, lockAddress: number, timeout = 2000) {
  const commandHex = buildOpenLockCommand(boardAddress, lockAddress)
  const frame = await padSingleDevice.requestFrame(
    () => padSingleDevice.sendHex(commandHex),
    (item) =>
      item.header === '8A' &&
      item.boardAddress === boardAddress &&
      item.lockAddress === lockAddress,
    timeout
  )

  return {
    commandHex,
    frame
  }
}

export async function queryPadLockStatus(boardAddress: number, lockAddress: number, timeout = 2000) {
  const commandHex = buildQueryLockStatusCommand(boardAddress, lockAddress)
  const frame = await padSingleDevice.requestFrame(
    () => padSingleDevice.sendHex(commandHex),
    (item) =>
      item.header === '80' &&
      item.boardAddress === boardAddress &&
      item.lockAddress === lockAddress,
    timeout
  )

  return {
    commandHex,
    frame
  }
}

export async function enablePadLockKeepOpen(
  boardAddress: number,
  lockAddress: number,
  timeout = 2000
) {
  const commandHex = buildEnableHoldOpenCommand(boardAddress, lockAddress)
  const rawResponseHex = await padSingleDevice.requestRawResponse(
    () => padSingleDevice.sendHex(commandHex),
    {
      timeout,
      optional: true
    }
  )

  return {
    commandHex,
    rawResponseHex,
    parsedResponse: parsePadVariableCommandResponse('9A', rawResponseHex)
  }
}

export async function disablePadLockKeepOpen(
  boardAddress: number,
  lockAddress: number,
  timeout = 2000
) {
  const commandHex = buildDisableHoldOpenCommand(boardAddress, lockAddress)
  const rawResponseHex = await padSingleDevice.requestRawResponse(
    () => padSingleDevice.sendHex(commandHex),
    {
      timeout,
      optional: true
    }
  )

  return {
    commandHex,
    rawResponseHex,
    parsedResponse: parsePadVariableCommandResponse('9B', rawResponseHex)
  }
}

export async function sendPadRawHex(rawHex: string) {
  const commandHex = requirePadHexPayload(normalizePadHex(rawHex), '自定义 HEX')
  await padSingleDevice.sendHex(commandHex)
  return commandHex
}

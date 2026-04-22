// 引入 Lock 设备单例，负责真正的串口发送与响应等待。
import { lockDevice } from './LockDevice'
// 引入协议层命令构造器与原始响应解析工具。
import {
  buildDisableHoldOpenCommand,
  buildEnableHoldOpenCommand,
  buildOpenLockCommand,
  buildQueryLockStatusCommand,
  normalizeLockHex,
  parseLockVariableCommandResponse,
  requireLockHexPayload
} from './LockProtocol'

// 普通锁开锁：发送 8A，并等待对应板地址/锁地址的 8A 响应。
export async function openLock(
  // 目标板地址。
  boardAddress: number,
  // 目标锁地址。
  lockAddress: number,
  // 超时时间，默认 2 秒。
  timeout = 2000,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先按协议拼出开锁命令。
  const commandHex = buildOpenLockCommand(boardAddress, lockAddress)
  // 发送命令，并等待一条满足条件的固定长度反馈帧。
  const frame = await lockDevice.requestFrame(
    // 真正执行发送动作。
    () => lockDevice.sendHex(commandHex, sessionId),
    // 只接受同一个板地址、同一个锁地址且头字节为 8A 的反馈。
    (item) =>
      item.header === '8A' &&
      item.boardAddress === boardAddress &&
      item.lockAddress === lockAddress,
    // 等待超时。
    timeout,
    // 目标会话。
    sessionId
  )

  // 返回发送命令和命中的响应帧，便于页面展示。
  return {
    commandHex,
    frame
  }
}

// 单锁状态查询：发送 80，并等待对应地址的 80 响应。
export async function queryLockStatus(
  // 目标板地址。
  boardAddress: number,
  // 目标锁地址。
  lockAddress: number,
  // 超时时间，默认 2 秒。
  timeout = 2000,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先构造状态查询命令。
  const commandHex = buildQueryLockStatusCommand(boardAddress, lockAddress)
  // 发送命令，并等待一条满足条件的 80 响应。
  const frame = await lockDevice.requestFrame(
    // 真正执行发送。
    () => lockDevice.sendHex(commandHex, sessionId),
    // 只接收与当前目标地址匹配的状态查询反馈。
    (item) =>
      item.header === '80' &&
      item.boardAddress === boardAddress &&
      item.lockAddress === lockAddress,
    // 等待超时。
    timeout,
    // 目标会话。
    sessionId
  )

  // 返回命令与命中的结构化反馈帧。
  return {
    commandHex,
    frame
  }
}

// 电磁锁开启长通电：先保留原始返回，再按 9A 规则尽量解析。
export async function enableLockKeepOpen(
  // 目标板地址。
  boardAddress: number,
  // 目标锁地址。
  lockAddress: number,
  // 超时时间，默认 2 秒。
  timeout = 2000,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先构造开启长通电命令。
  const commandHex = buildEnableHoldOpenCommand(boardAddress, lockAddress)
  // 等待原始响应串，9A/9B 的返回长度不稳定，所以这里走原始响应模式。
  const rawResponseHex = await lockDevice.requestRawResponse(
    // 真正执行发送。
    () => lockDevice.sendHex(commandHex, sessionId),
    {
      // 响应整体超时。
      timeout,
      // 某些设备可能不回 9A，所以允许空响应。
      optional: true
    },
    // 目标会话。
    sessionId
  )

  // 返回发送命令、原始响应，以及尽量解析后的结果。
  return {
    commandHex,
    rawResponseHex,
    parsedResponse: parseLockVariableCommandResponse('9A', rawResponseHex)
  }
}

// 电磁锁关闭长通电：先保留原始返回，再按 9B 规则尽量解析。
export async function disableLockKeepOpen(
  // 目标板地址。
  boardAddress: number,
  // 目标锁地址。
  lockAddress: number,
  // 超时时间，默认 2 秒。
  timeout = 2000,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先构造关闭长通电命令。
  const commandHex = buildDisableHoldOpenCommand(boardAddress, lockAddress)
  // 获取长度不稳定的原始响应串。
  const rawResponseHex = await lockDevice.requestRawResponse(
    // 真正执行发送。
    () => lockDevice.sendHex(commandHex, sessionId),
    {
      // 响应整体超时。
      timeout,
      // 某些设备可能不回 9B，所以允许空响应。
      optional: true
    },
    // 目标会话。
    sessionId
  )

  // 返回发送命令、原始响应，以及尽量解析后的结果。
  return {
    commandHex,
    rawResponseHex,
    parsedResponse: parseLockVariableCommandResponse('9B', rawResponseHex)
  }
}

// 自定义 HEX 直接透传到设备，主要用于联调和补测。
export async function sendLockRawHex(
  // 原始 HEX 文本。
  rawHex: string,
  // 目标会话，可选。
  sessionId?: number
) {
  // 先做标准化和合法性校验。
  const commandHex = requireLockHexPayload(normalizeLockHex(rawHex), '自定义 HEX')
  // 再把合法的 HEX 发给设备。
  await lockDevice.sendHex(commandHex, sessionId)
  // 返回最终发送的标准化命令串。
  return commandHex
}

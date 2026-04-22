// 引入 LED 设备单例，使用独立会话发送能力。
import { ledSingleDevice } from './LedDevice'
// 引入 LED 组帧工具。
import {
  buildShowAllLedsCommand,
  buildShowSingleLedCommand,
  buildTurnOffAllLedsCommand,
  buildTurnOffSingleLedCommand,
  type LedColorCode,
  type LedDisplayMode
} from './LedProtocol'

// 控制单个灯显示指定颜色和模式。
export async function showSingleLed(
  // 目标灯地址（0x0001-0x00FF）。
  ledAddress: number,
  // 显示模式。
  mode: LedDisplayMode,
  // 颜色编码。
  color: LedColorCode,
  // 模块地址，默认 0x01。
  moduleId = 0x01,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先组装单灯显示命令。
  const commandHex = buildShowSingleLedCommand(ledAddress, mode, color, moduleId)
  // 只发送，不等待响应。
  await ledSingleDevice.sendHex(commandHex, sessionId)
  // 返回发送命令，便于页面侧记录。
  return commandHex
}

// 关闭单个灯。
export async function turnOffSingleLed(
  // 目标灯地址（0x0001-0x00FF）。
  ledAddress: number,
  // 模块地址，默认 0x01。
  moduleId = 0x01,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先组装单灯关闭命令。
  const commandHex = buildTurnOffSingleLedCommand(ledAddress, moduleId)
  // 只发送，不等待响应。
  await ledSingleDevice.sendHex(commandHex, sessionId)
  // 返回发送命令。
  return commandHex
}

// 控制所有灯显示指定颜色和模式。
export async function showAllLeds(
  // 显示模式。
  mode: LedDisplayMode,
  // 颜色编码。
  color: LedColorCode,
  // 模块地址，默认 0x01。
  moduleId = 0x01,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先组装全体显示命令。
  const commandHex = buildShowAllLedsCommand(mode, color, moduleId)
  // 只发送，不等待响应。
  await ledSingleDevice.sendHex(commandHex, sessionId)
  // 返回发送命令。
  return commandHex
}

// 关闭所有灯。
export async function turnOffAllLeds(
  // 模块地址，默认 0x01。
  moduleId = 0x01,
  // 串口会话 ID，可选。
  sessionId?: number
) {
  // 先组装全体关闭命令。
  const commandHex = buildTurnOffAllLedsCommand(moduleId)
  // 只发送，不等待响应。
  await ledSingleDevice.sendHex(commandHex, sessionId)
  // 返回发送命令。
  return commandHex
}

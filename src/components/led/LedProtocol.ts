// LED 模块默认地址。
export const DEFAULT_LED_MODULE_ID = 0x01
// 全体控制命令里默认亮度。
export const DEFAULT_LED_BRIGHTNESS = 0xFF

// LED 显示模式。
export type LedDisplayMode =
  // 常亮。
  | 0x00
  // 慢闪。
  | 0x01
  // 快闪。
  | 0x02

// LED 颜色编码。
export type LedColorCode =
  // 关闭/无。
  | 0x00
  // 红。
  | 0x01
  // 绿。
  | 0x02
  // 蓝。
  | 0x03
  // 黄。
  | 0x04
  // 青。
  | 0x05
  // 紫。
  | 0x06
  // 白。
  | 0x07
  // 自定义颜色 1。
  | 0x08
  // 自定义颜色 2。
  | 0x09
  // 自定义颜色 3。
  | 0x0A
  // 自定义颜色 4。
  | 0x0B
  // 自定义颜色 5。
  | 0x0C
  // 自定义颜色 6。
  | 0x0D
  // 自定义颜色 7。
  | 0x0E
  // 自定义颜色 8。
  | 0x0F

// 转换并校验单字节十进制输入。
function toLedHexByte(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
    throw new Error(`${label}必须是 0-255 的整数`)
  }

  return value.toString(16).toUpperCase().padStart(2, '0')
}

// 转换并校验两字节十进制输入。
function toLedHexWord(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
    throw new Error(`${label}必须是 0-65535 的整数`)
  }

  return value.toString(16).toUpperCase().padStart(4, '0')
}

// 校验单灯地址范围。
function validateLedAddress(ledAddress: number) {
  if (!Number.isInteger(ledAddress) || ledAddress < 0x0001 || ledAddress > 0x00FF) {
    throw new Error('灯地址必须是 0x0001-0x00FF 的整数')
  }
}

// 校验显示模式范围。
function validateLedMode(mode: number) {
  if (!Number.isInteger(mode) || mode < 0x00 || mode > 0x02) {
    throw new Error('模式必须是 0x00-0x02 的整数')
  }
}

// 校验颜色范围。
function validateLedColor(color: number) {
  if (!Number.isInteger(color) || color < 0x00 || color > 0x0F) {
    throw new Error('颜色必须是 0x00-0x0F 的整数')
  }
}

// 按 Modbus CRC16 规则计算校验值（低字节在前）。
function computeModbusCrcHex(hexBytes: readonly string[]) {
  let crc = 0xFFFF

  for (const item of hexBytes) {
    const byte = parseInt(item, 16)
    crc ^= byte

    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xA001
      } else {
        crc >>= 1
      }
    }
  }

  const crcLow = (crc & 0xFF).toString(16).toUpperCase().padStart(2, '0')
  const crcHigh = ((crc >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0')
  return `${crcLow}${crcHigh}`
}

// 组装一条完整的 Modbus 指令。
function buildLedModbusCommand(bytes: readonly string[]) {
  return `${bytes.join('')}${computeModbusCrcHex(bytes)}`
}

// 控制单个灯显示指定模式和颜色。
export function buildShowSingleLedCommand(
  ledAddress: number,
  mode: LedDisplayMode,
  color: LedColorCode,
  moduleId = DEFAULT_LED_MODULE_ID
) {
  validateLedAddress(ledAddress)
  validateLedMode(mode)
  validateLedColor(color)

  const moduleHex = toLedHexByte(moduleId, '模块地址')
  const ledAddressHex = toLedHexWord(ledAddress, '灯地址')
  const modeHex = toLedHexByte(mode, '显示模式')
  const colorHex = toLedHexByte(color, '颜色')

  const payload = [
    moduleHex,
    '06',
    ledAddressHex.slice(0, 2),
    ledAddressHex.slice(2, 4),
    modeHex,
    colorHex
  ]

  return buildLedModbusCommand(payload)
}

// 关闭单个灯。
export function buildTurnOffSingleLedCommand(
  ledAddress: number,
  moduleId = DEFAULT_LED_MODULE_ID
) {
  return buildShowSingleLedCommand(ledAddress, 0x00, 0x00, moduleId)
}

// 控制所有灯显示指定模式和颜色。
export function buildShowAllLedsCommand(
  mode: LedDisplayMode,
  color: LedColorCode,
  moduleId = DEFAULT_LED_MODULE_ID,
  brightness = DEFAULT_LED_BRIGHTNESS
) {
  validateLedMode(mode)
  validateLedColor(color)

  const moduleHex = toLedHexByte(moduleId, '模块地址')
  const modeHex = toLedHexByte(mode, '显示模式')
  const colorHex = toLedHexByte(color, '颜色')
  const brightnessHex = toLedHexByte(brightness, '亮度')

  const payload = [moduleHex, '05', modeHex, colorHex, brightnessHex, '00']
  return buildLedModbusCommand(payload)
}

// 关闭所有灯。
export function buildTurnOffAllLedsCommand(
  moduleId = DEFAULT_LED_MODULE_ID,
  brightness = DEFAULT_LED_BRIGHTNESS
) {
  return buildShowAllLedsCommand(0x00, 0x00, moduleId, brightness)
}

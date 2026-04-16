// PAD 协议当前页面会遇到的响应头集合。
export const PAD_RESPONSE_HEADS = ['80', '81', '8A', '9A', '9B'] as const

// 已确认固定长度的 PAD 状态类响应统一为 5 字节。
export const PAD_STANDARD_STATUS_FRAME_BYTE_LENGTH = 5

export type PadCommandHead = (typeof PAD_RESPONSE_HEADS)[number]

export type PadFrameType =
  | 'status-query-feedback'
  | 'manual-status-report'
  | 'open-lock-feedback'
  | 'enable-hold-feedback'
  | 'disable-hold-feedback'
  | 'unknown'

export type PadFixedResponseRuleKey =
  | 'status-query-feedback'
  | 'manual-status-report'
  | 'open-lock-feedback'

// 固定长度响应的抽象规则，便于接收层统一拆帧。
export interface PadFixedLengthResponseRule {
  key: PadFixedResponseRuleKey
  requestHead?: PadCommandHead
  responseHead: PadCommandHead
  byteLength: number
  description: string
}

// 解析完成后的 PAD 帧结构，页面和 helper 都以这份数据为准。
export interface PadParsedFrame {
  rawHex: string
  header: string
  type: PadFrameType
  boardAddress: number
  boardAddressHex: string
  lockAddress: number
  lockAddressHex: string
  status: number
  statusHex: string
  bccHex: string
  expectedBccHex: string
  bccValid: boolean
}

// 文档中已经明确长度的几类响应放在这里统一管理。
export const PAD_FIXED_LENGTH_RESPONSE_RULES: readonly PadFixedLengthResponseRule[] = [
  {
    key: 'status-query-feedback',
    requestHead: '80',
    responseHead: '80',
    byteLength: PAD_STANDARD_STATUS_FRAME_BYTE_LENGTH,
    description: '单锁状态查询反馈'
  },
  {
    key: 'manual-status-report',
    responseHead: '81',
    byteLength: PAD_STANDARD_STATUS_FRAME_BYTE_LENGTH,
    description: '手动关门/微动主动上报'
  },
  {
    key: 'open-lock-feedback',
    requestHead: '8A',
    responseHead: '8A',
    byteLength: PAD_STANDARD_STATUS_FRAME_BYTE_LENGTH,
    description: '开锁反馈'
  }
] as const

// 统一把输入转成连续的大写 HEX，便于后续校验和比较。
export function normalizePadHex(input: string) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

// 要求输入必须是合法的偶数位 HEX，否则直接报错。
export function requirePadHexPayload(input: string, label = 'HEX') {
  const value = normalizePadHex(input)
  if (!value) {
    throw new Error(`${label}不能为空`)
  }
  if (!/^[0-9A-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label}必须是偶数位 HEX`)
  }
  return value
}

// 日志和页面展示时统一按空格分隔字节，便于肉眼查看。
export function formatPadHex(hex: string) {
  const normalized = normalizePadHex(hex)
  if (!normalized) {
    return ''
  }
  return normalized.match(/.{1,2}/g)?.join(' ') ?? ''
}

// 判断某个字节是否属于当前已知的响应头。
export function isPadResponseHead(head: string): head is PadCommandHead {
  return PAD_RESPONSE_HEADS.includes(head as PadCommandHead)
}

// 十进制地址统一转成单字节 HEX。
export function toPadHexByte(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
    throw new Error(`${label}必须是 0-255 的整数`)
  }
  return value.toString(16).toUpperCase().padStart(2, '0')
}

// PAD 协议的 BCC 规则是前面所有字节逐个异或。
export function computePadBccHex(hexBytes: readonly string[]) {
  const result = hexBytes.reduce((current, item) => {
    const hex = requirePadHexPayload(item, 'HEX 字节')
    if (hex.length !== 2) {
      throw new Error('BCC 计算仅支持单字节输入')
    }
    return current ^ parseInt(hex, 16)
  }, 0)

  return result.toString(16).toUpperCase().padStart(2, '0')
}

// 组装通用 PAD 指令：命令头 + 板地址 + 锁地址 + 功能码 + BCC。
function buildPadCommand(head: string, boardAddress: number, lockAddress: number, functionCode: string) {
  const boardHex = toPadHexByte(boardAddress, '板地址')
  const lockHex = toPadHexByte(lockAddress, '锁地址')
  const codeHex = requirePadHexPayload(functionCode, '功能码')
  if (codeHex.length !== 2) {
    throw new Error('功能码必须是单字节 HEX')
  }
  const payload = [head, boardHex, lockHex, codeHex]
  return `${payload.join('')}${computePadBccHex(payload)}`
}

// 开锁命令。
export function buildOpenLockCommand(boardAddress: number, lockAddress: number) {
  return buildPadCommand('8A', boardAddress, lockAddress, '11')
}

// 单锁状态查询命令。
export function buildQueryLockStatusCommand(boardAddress: number, lockAddress: number) {
  return buildPadCommand('80', boardAddress, lockAddress, '33')
}

// 开启长通电命令。
export function buildEnableHoldOpenCommand(boardAddress: number, lockAddress: number) {
  return buildPadCommand('9A', boardAddress, lockAddress, '11')
}

// 关闭长通电命令。
export function buildDisableHoldOpenCommand(boardAddress: number, lockAddress: number) {
  return buildPadCommand('9B', boardAddress, lockAddress, '11')
}

// 按固定长度规则从缓冲里提取完整帧，并保留未消费的尾巴供下次继续拼接。
export function extractPadFixedLengthFrames(
  buffer: string,
  rules: readonly PadFixedLengthResponseRule[] = PAD_FIXED_LENGTH_RESPONSE_RULES
) {
  let rest = normalizePadHex(buffer)
  const frames: string[] = []
  const maxFrameHexLength = Math.max(...rules.map((rule) => rule.byteLength * 2))

  while (rest.length >= 2) {
    const alignedIndex = findFixedFrameHeadIndex(rest, rules)
    if (alignedIndex === -1) {
      rest = rest.slice(-Math.max(maxFrameHexLength - 2, 0))
      break
    }

    if (alignedIndex > 0) {
      rest = rest.slice(alignedIndex)
    }

    const head = rest.slice(0, 2)
    const rule = rules.find((item) => item.responseHead === head)
    if (!rule) {
      rest = rest.slice(2)
      continue
    }

    const frameHexLength = rule.byteLength * 2
    if (rest.length < frameHexLength) {
      break
    }

    const candidate = rest.slice(0, frameHexLength)
    if (parsePadFrame(candidate)) {
      frames.push(candidate)
      rest = rest.slice(frameHexLength)
      continue
    }

    rest = rest.slice(2)
  }

  return {
    // 本次成功提取出的完整帧。
    frames,
    // 仍然不足一帧的残留数据。
    rest
  }
}

// 把标准 5 字节 PAD 响应解析成结构化对象。
export function parsePadFrame(rawHex: string): PadParsedFrame | null {
  const hex = normalizePadHex(rawHex)
  if (!/^[0-9A-F]{10}$/.test(hex)) {
    return null
  }

  const header = hex.slice(0, 2)
  if (!isPadResponseHead(header)) {
    return null
  }

  const boardAddressHex = hex.slice(2, 4)
  const lockAddressHex = hex.slice(4, 6)
  const statusHex = hex.slice(6, 8)
  const bccHex = hex.slice(8, 10)
  const expectedBccHex = computePadBccHex([
    header,
    boardAddressHex,
    lockAddressHex,
    statusHex
  ])

  return {
    rawHex: hex,
    header,
    type: getPadFrameType(header),
    boardAddress: parseInt(boardAddressHex, 16),
    boardAddressHex,
    lockAddress: parseInt(lockAddressHex, 16),
    lockAddressHex,
    status: parseInt(statusHex, 16),
    statusHex,
    bccHex,
    expectedBccHex,
    bccValid: bccHex === expectedBccHex
  }
}

// 9A/9B 的反馈格式不完全稳定，因此这里先保留原始响应，再尽量提取可识别的帧。
export function parsePadVariableCommandResponse(commandHead: '9A' | '9B', rawHex: string) {
  const normalized = normalizePadHex(rawHex)
  if (!normalized) {
    return {
      rawHex: '',
      parsedFrames: [] as PadParsedFrame[]
    }
  }

  const parsedFrames: PadParsedFrame[] = []

  const exactFrame = parsePadFrame(normalized)
  if (exactFrame && exactFrame.header === commandHead) {
    parsedFrames.push(exactFrame)
  }

  const extracted = extractPadFixedLengthFrames(normalized, [
    {
      key: 'status-query-feedback',
      responseHead: commandHead,
      byteLength: PAD_STANDARD_STATUS_FRAME_BYTE_LENGTH,
      description: commandHead === '9A' ? '开启长通电反馈' : '关闭长通电反馈'
    },
    ...PAD_FIXED_LENGTH_RESPONSE_RULES
  ])

  extracted.frames.forEach((frameHex) => {
    const frame = parsePadFrame(frameHex)
    if (!frame) {
      return
    }
    if (parsedFrames.some((item) => item.rawHex === frame.rawHex)) {
      return
    }
    parsedFrames.push(frame)
  })

  return {
    rawHex: normalized,
    parsedFrames
  }
}

// 页面展示时使用的人类可读反馈名称。
export function getPadFrameLabel(frame: Pick<PadParsedFrame, 'header' | 'type'>) {
  switch (frame.type) {
    case 'status-query-feedback':
      return '状态查询反馈'
    case 'manual-status-report':
      return '主动状态上报'
    case 'open-lock-feedback':
      return '开锁反馈'
    case 'enable-hold-feedback':
      return '开启长通电反馈'
    case 'disable-hold-feedback':
      return '关闭长通电反馈'
    default:
      return `未知反馈(${frame.header})`
  }
}

// 当前页面采用的状态文案解释规则。
export function resolvePadFrameStatusText(frame: PadParsedFrame) {
  switch (frame.type) {
    case 'open-lock-feedback':
      if (frame.statusHex === '11') return '开锁成功 / 当前为开'
      if (frame.statusHex === '00') return '开锁失败 / 当前未开'
      break

    case 'manual-status-report':
      if (frame.statusHex === '11') return '微动按下'
      if (frame.statusHex === '00') return '微动松开 / 手动关锁后常见反馈'
      break

    case 'status-query-feedback':
      if (frame.statusHex === '11') return '查询状态位 11'
      if (frame.statusHex === '00') return '查询状态位 00'
      break

    case 'enable-hold-feedback':
      if (frame.statusHex === '11') return '开启长通电反馈 / 状态位 11'
      if (frame.statusHex === '00') return '开启长通电反馈 / 状态位 00'
      return '开启长通电反馈'

    case 'disable-hold-feedback':
      if (frame.statusHex === '11') return '关闭长通电反馈 / 状态位 11'
      if (frame.statusHex === '00') return '关闭长通电反馈 / 状态位 00'
      return '关闭长通电反馈'

    default:
      break
  }

  return `未知状态 ${frame.statusHex}`
}

// 把结构化帧拼成一条简短的中文摘要，便于页面展示。
export function describePadFrame(frame: PadParsedFrame) {
  const statusText = resolvePadFrameStatusText(frame)
  const bccText = frame.bccValid
    ? 'BCC 通过'
    : `BCC 错误(期望 ${frame.expectedBccHex})`

  return `${getPadFrameLabel(frame)} 板=${frame.boardAddress} 锁=${frame.lockAddress} 状态=${frame.statusHex}(${statusText}) ${bccText}`
}

// 根据响应头映射出页面内部使用的帧类型。
function getPadFrameType(header: string): PadFrameType {
  switch (header) {
    case '80':
      return 'status-query-feedback'
    case '81':
      return 'manual-status-report'
    case '8A':
      return 'open-lock-feedback'
    case '9A':
      return 'enable-hold-feedback'
    case '9B':
      return 'disable-hold-feedback'
    default:
      return 'unknown'
  }
}

// 从缓冲里找到一个已知响应头的起始位置，用于固定长度拆帧。
function findFixedFrameHeadIndex(buffer: string, rules: readonly PadFixedLengthResponseRule[]) {
  for (let index = 0; index <= buffer.length - 2; index += 2) {
    const head = buffer.slice(index, index + 2)
    if (rules.some((rule) => rule.responseHead === head)) {
      return index
    }
  }
  return -1
}

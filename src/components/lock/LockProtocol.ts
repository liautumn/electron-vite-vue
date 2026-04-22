// Lock 协议当前页面会遇到的响应头集合。
export const LOCK_RESPONSE_HEADS = ['80', '81', '8A', '9A', '9B'] as const

// 已确认固定长度的 Lock 状态类响应统一为 5 字节。
export const LOCK_STANDARD_STATUS_FRAME_BYTE_LENGTH = 5

// 允许出现的命令头/响应头类型。
export type LockCommandHead = (typeof LOCK_RESPONSE_HEADS)[number]

// 页面内部对 Lock 帧做的语义分类。
export type LockFrameType =
  // 查询锁状态返回的标准反馈。
  | 'status-query-feedback'
  // 设备主动上报的手动关门/微动状态。
  | 'manual-status-report'
  // 开锁反馈。
  | 'open-lock-feedback'
  // 开启长通电反馈。
  | 'enable-hold-feedback'
  // 关闭长通电反馈。
  | 'disable-hold-feedback'
  // 无法识别的类型。
  | 'unknown'

// 固定长度规则集里当前实际维护的 key。
export type LockFixedResponseRuleKey =
  // 状态查询反馈。
  | 'status-query-feedback'
  // 手动状态上报。
  | 'manual-status-report'
  // 开锁反馈。
  | 'open-lock-feedback'

// 固定长度响应的抽象规则，便于接收层统一拆帧。
export interface LockFixedLengthResponseRule {
  // 当前规则的业务 key。
  key: LockFixedResponseRuleKey
  // 发起该反馈时对应的请求头，可选。
  requestHead?: LockCommandHead
  // 实际响应头。
  responseHead: LockCommandHead
  // 响应总字节长度。
  byteLength: number
  // 规则的人类可读描述。
  description: string
}

// 解析完成后的 Lock 帧结构，页面和 helper 都以这份数据为准。
export interface LockParsedFrame {
  // 原始完整 HEX。
  rawHex: string
  // 帧头。
  header: string
  // 框架内部映射出来的帧类型。
  type: LockFrameType
  // 板地址十进制值。
  boardAddress: number
  // 板地址原始 HEX。
  boardAddressHex: string
  // 锁地址十进制值。
  lockAddress: number
  // 锁地址原始 HEX。
  lockAddressHex: string
  // 状态字十进制值。
  status: number
  // 状态字原始 HEX。
  statusHex: string
  // 原始 BCC。
  bccHex: string
  // 按规则重新计算得到的期望 BCC。
  expectedBccHex: string
  // BCC 是否通过。
  bccValid: boolean
}

// 文档中已经明确长度的几类响应放在这里统一管理。
export const LOCK_FIXED_LENGTH_RESPONSE_RULES: readonly LockFixedLengthResponseRule[] = [
  {
    // 单锁状态查询的固定长度反馈。
    key: 'status-query-feedback',
    // 对应请求头也是 80。
    requestHead: '80',
    // 响应头。
    responseHead: '80',
    // 固定 5 字节。
    byteLength: LOCK_STANDARD_STATUS_FRAME_BYTE_LENGTH,
    // 规则描述。
    description: '单锁状态查询反馈'
  },
  {
    // 设备主动上报。
    key: 'manual-status-report',
    // 主动上报没有请求头。
    responseHead: '81',
    // 固定 5 字节。
    byteLength: LOCK_STANDARD_STATUS_FRAME_BYTE_LENGTH,
    // 规则描述。
    description: '手动关门/微动主动上报'
  },
  {
    // 开锁反馈。
    key: 'open-lock-feedback',
    // 对应请求头 8A。
    requestHead: '8A',
    // 响应头 8A。
    responseHead: '8A',
    // 固定 5 字节。
    byteLength: LOCK_STANDARD_STATUS_FRAME_BYTE_LENGTH,
    // 规则描述。
    description: '开锁反馈'
  }
] as const

// 统一把输入转成连续的大写 HEX，便于后续校验和比较。
export function normalizeLockHex(input: string) {
  // 把空值兜底成空串，并移除所有空白字符。
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

// 要求输入必须是合法的偶数位 HEX，否则直接报错。
export function requireLockHexPayload(input: string, label = 'HEX') {
  // 先做标准化。
  const value = normalizeLockHex(input)
  // 空串直接报错。
  if (!value) {
    throw new Error(`${label}不能为空`)
  }
  // 只允许 0-9A-F，且长度必须是偶数。
  if (!/^[0-9A-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label}必须是偶数位 HEX`)
  }
  // 返回标准化后的合法 HEX。
  return value
}

// 日志和页面展示时统一按空格分隔字节，便于肉眼查看。
export function formatLockHex(hex: string) {
  // 先把输入规范成连续大写 HEX。
  const normalized = normalizeLockHex(hex)
  // 空串直接返回空串。
  if (!normalized) {
    return ''
  }
  // 每两位切成一个字节后用空格拼接。
  return normalized.match(/.{1,2}/g)?.join(' ') ?? ''
}

// 判断某个字节是否属于当前已知的响应头。
export function isLockResponseHead(head: string): head is LockCommandHead {
  // 直接在已知响应头集合里判断。
  return LOCK_RESPONSE_HEADS.includes(head as LockCommandHead)
}

// 十进制地址统一转成单字节 HEX。
export function toLockHexByte(value: number, label: string) {
  // 板地址和锁地址都必须落在单字节范围。
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
    throw new Error(`${label}必须是 0-255 的整数`)
  }
  // 转成两位大写 HEX。
  return value.toString(16).toUpperCase().padStart(2, '0')
}

// Lock 协议的 BCC 规则是前面所有字节逐个异或。
export function computeLockBccHex(hexBytes: readonly string[]) {
  // 从 0 开始，把每个字节做异或累积。
  const result = hexBytes.reduce((current, item) => {
    // 先校验输入项必须是合法 HEX。
    const hex = requireLockHexPayload(item, 'HEX 字节')
    // BCC 计算只接受单字节。
    if (hex.length !== 2) {
      throw new Error('BCC 计算仅支持单字节输入')
    }
    // 当前累计值与本字节异或。
    return current ^ parseInt(hex, 16)
  }, 0)

  // 结果同样转成两位大写 HEX。
  return result.toString(16).toUpperCase().padStart(2, '0')
}

// 组装通用 Lock 指令：命令头 + 板地址 + 锁地址 + 功能码 + BCC。
function buildLockCommand(head: string, boardAddress: number, lockAddress: number, functionCode: string) {
  // 板地址转单字节 HEX。
  const boardHex = toLockHexByte(boardAddress, '板地址')
  // 锁地址转单字节 HEX。
  const lockHex = toLockHexByte(lockAddress, '锁地址')
  // 功能码也做合法性校验。
  const codeHex = requireLockHexPayload(functionCode, '功能码')
  // 功能码只允许单字节。
  if (codeHex.length !== 2) {
    throw new Error('功能码必须是单字节 HEX')
  }
  // BCC 参与计算的原始字节序列。
  const payload = [head, boardHex, lockHex, codeHex]
  // 返回完整命令串。
  return `${payload.join('')}${computeLockBccHex(payload)}`
}

// 开锁命令。
export function buildOpenLockCommand(boardAddress: number, lockAddress: number) {
  // 8A + 功能码 11 表示开锁。
  return buildLockCommand('8A', boardAddress, lockAddress, '11')
}

// 单锁状态查询命令。
export function buildQueryLockStatusCommand(boardAddress: number, lockAddress: number) {
  // 80 + 功能码 33 表示单锁状态查询。
  return buildLockCommand('80', boardAddress, lockAddress, '33')
}

// 开启长通电命令。
export function buildEnableHoldOpenCommand(boardAddress: number, lockAddress: number) {
  // 9A + 功能码 11 表示开启长通电。
  return buildLockCommand('9A', boardAddress, lockAddress, '11')
}

// 关闭长通电命令。
export function buildDisableHoldOpenCommand(boardAddress: number, lockAddress: number) {
  // 9B + 功能码 11 表示关闭长通电。
  return buildLockCommand('9B', boardAddress, lockAddress, '11')
}

// 按固定长度规则从缓冲里提取完整帧，并保留未消费的尾巴供下次继续拼接。
export function extractLockFixedLengthFrames(
  // 当前累计缓冲。
  buffer: string,
  // 允许外部覆盖规则集，默认用项目内置规则。
  rules: readonly LockFixedLengthResponseRule[] = LOCK_FIXED_LENGTH_RESPONSE_RULES
) {
  // 先把缓冲规范成连续大写 HEX。
  let rest = normalizeLockHex(buffer)
  // 收集本次提取到的完整帧。
  const frames: string[] = []
  // 规则里最大的帧长度，用于在找不到头时保留尾巴。
  const maxFrameHexLength = Math.max(...rules.map((rule) => rule.byteLength * 2))

  // 只要缓冲里至少还有 1 个字节，就继续尝试拆帧。
  while (rest.length >= 2) {
    // 找到下一个可能的已知响应头位置。
    const alignedIndex = findFixedFrameHeadIndex(rest, rules)
    // 完全找不到已知头时，只保留一段可能拼出下帧的尾巴。
    if (alignedIndex === -1) {
      rest = rest.slice(-Math.max(maxFrameHexLength - 2, 0))
      break
    }

    // 如果头之前有脏数据，直接丢弃到头位置。
    if (alignedIndex > 0) {
      rest = rest.slice(alignedIndex)
    }

    // 取当前头字节。
    const head = rest.slice(0, 2)
    // 根据头字节找到对应规则。
    const rule = rules.find((item) => item.responseHead === head)
    // 理论上不会进这里，但为了稳妥仍然保留兜底。
    if (!rule) {
      rest = rest.slice(2)
      continue
    }

    // 计算当前规则期望的完整帧长度。
    const frameHexLength = rule.byteLength * 2
    // 当前缓冲不足一帧时停止，等待下一次继续拼接。
    if (rest.length < frameHexLength) {
      break
    }

    // 先按长度切出一个候选帧。
    const candidate = rest.slice(0, frameHexLength)
    // 如果候选帧可以通过基础解析，就认定为一帧。
    if (parseLockFrame(candidate)) {
      frames.push(candidate)
      rest = rest.slice(frameHexLength)
      continue
    }

    // 候选帧不合法时，向后挪一个字节继续找头。
    rest = rest.slice(2)
  }

  return {
    // 本次成功提取出的完整帧。
    frames,
    // 仍然不足一帧的残留数据。
    rest
  }
}

// 把标准 5 字节 Lock 响应解析成结构化对象。
export function parseLockFrame(rawHex: string): LockParsedFrame | null {
  // 先把输入规范成连续大写 HEX。
  const hex = normalizeLockHex(rawHex)
  // 标准固定长度帧必须恰好是 10 个十六进制字符。
  if (!/^[0-9A-F]{10}$/.test(hex)) {
    return null
  }

  // 拆出帧头。
  const header = hex.slice(0, 2)
  // 帧头不是已知响应头就不认。
  if (!isLockResponseHead(header)) {
    return null
  }

  // 拆出板地址。
  const boardAddressHex = hex.slice(2, 4)
  // 拆出锁地址。
  const lockAddressHex = hex.slice(4, 6)
  // 拆出状态字。
  const statusHex = hex.slice(6, 8)
  // 拆出原始 BCC。
  const bccHex = hex.slice(8, 10)
  // 重新计算期望 BCC。
  const expectedBccHex = computeLockBccHex([
    header,
    boardAddressHex,
    lockAddressHex,
    statusHex
  ])

  // 返回结构化结果。
  return {
    rawHex: hex,
    header,
    type: getLockFrameType(header),
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
export function parseLockVariableCommandResponse(commandHead: '9A' | '9B', rawHex: string) {
  // 先标准化原始响应。
  const normalized = normalizeLockHex(rawHex)
  // 空响应直接返回空结果。
  if (!normalized) {
    return {
      rawHex: '',
      parsedFrames: [] as LockParsedFrame[]
    }
  }

  // 收集当前原始响应里能识别出的结构化帧。
  const parsedFrames: LockParsedFrame[] = []

  // 如果整段原始响应本身就是一条完整标准帧，先直接尝试解析。
  const exactFrame = parseLockFrame(normalized)
  // 只有帧头和目标命令头一致时才收下。
  if (exactFrame && exactFrame.header === commandHead) {
    parsedFrames.push(exactFrame)
  }

  // 再按“目标命令头 + 标准规则”的组合规则尝试从原始响应里拆更多帧。
  const extracted = extractLockFixedLengthFrames(normalized, [
    {
      // 这里借用固定长度拆帧能力，把 9A/9B 也当作一类临时规则。
      key: 'status-query-feedback',
      // 响应头就是当前命令头。
      responseHead: commandHead,
      // 9A/9B 这里也按标准 5 字节长度尝试切帧。
      byteLength: LOCK_STANDARD_STATUS_FRAME_BYTE_LENGTH,
      // 给出一条便于调试的规则描述。
      description: commandHead === '9A' ? '开启长通电反馈' : '关闭长通电反馈'
    },
    // 同时保留系统已知的标准规则。
    ...LOCK_FIXED_LENGTH_RESPONSE_RULES
  ])

  // 对提取到的每一帧再做一次结构化解析。
  extracted.frames.forEach((frameHex) => {
    // 解析结构化帧。
    const frame = parseLockFrame(frameHex)
    // 解析失败则跳过。
    if (!frame) {
      return
    }
    // 如果这帧已经因为 exactFrame 被收录过，就不重复加入。
    if (parsedFrames.some((item) => item.rawHex === frame.rawHex)) {
      return
    }
    // 收下新的结构化帧。
    parsedFrames.push(frame)
  })

  return {
    // 保留标准化后的完整原始响应。
    rawHex: normalized,
    // 返回尽量解析出的所有帧。
    parsedFrames
  }
}

// 页面展示时使用的人类可读反馈名称。
export function getLockFrameLabel(frame: Pick<LockParsedFrame, 'header' | 'type'>) {
  switch (frame.type) {
    // 状态查询反馈。
    case 'status-query-feedback':
      return '状态查询反馈'
    // 主动状态上报。
    case 'manual-status-report':
      return '主动状态上报'
    // 开锁反馈。
    case 'open-lock-feedback':
      return '开锁反馈'
    // 开启长通电反馈。
    case 'enable-hold-feedback':
      return '开启长通电反馈'
    // 关闭长通电反馈。
    case 'disable-hold-feedback':
      return '关闭长通电反馈'
    // 兜底未知类型。
    default:
      return `未知反馈(${frame.header})`
  }
}

// 当前页面采用的状态文案解释规则。
export function resolveLockFrameStatusText(frame: LockParsedFrame) {
  switch (frame.type) {
    case 'open-lock-feedback':
      // `11` 一般表示成功或当前为开。
      if (frame.statusHex === '11') return '开锁成功 / 当前为开'
      // `00` 一般表示失败或当前未开。
      if (frame.statusHex === '00') return '开锁失败 / 当前未开'
      break

    case 'manual-status-report':
      // `11` 表示微动按下。
      if (frame.statusHex === '11') return '微动按下'
      // `00` 常见于微动松开或手动关锁。
      if (frame.statusHex === '00') return '微动松开 / 手动关锁后常见反馈'
      break

    case 'status-query-feedback':
      // 当前页面只对文档里常见的两种状态位给出解释。
      if (frame.statusHex === '11') return '查询状态位 11'
      if (frame.statusHex === '00') return '查询状态位 00'
      break

    case 'enable-hold-feedback':
      // 开启长通电后常见状态位解释。
      if (frame.statusHex === '11') return '开启长通电反馈 / 状态位 11'
      if (frame.statusHex === '00') return '开启长通电反馈 / 状态位 00'
      return '开启长通电反馈'

    case 'disable-hold-feedback':
      // 关闭长通电后常见状态位解释。
      if (frame.statusHex === '11') return '关闭长通电反馈 / 状态位 11'
      if (frame.statusHex === '00') return '关闭长通电反馈 / 状态位 00'
      return '关闭长通电反馈'

    default:
      break
  }

  // 兜底输出未知状态字。
  return `未知状态 ${frame.statusHex}`
}

// 把结构化帧拼成一条简短的中文摘要，便于页面展示。
export function describeLockFrame(frame: LockParsedFrame) {
  // 先拿到状态文案。
  const statusText = resolveLockFrameStatusText(frame)
  // 再生成 BCC 校验描述。
  const bccText = frame.bccValid
    ? 'BCC 通过'
    : `BCC 错误(期望 ${frame.expectedBccHex})`

  // 最后拼成一条完整摘要。
  return `${getLockFrameLabel(frame)} 板=${frame.boardAddress} 锁=${frame.lockAddress} 状态=${frame.statusHex}(${statusText}) ${bccText}`
}

// 根据响应头映射出页面内部使用的帧类型。
function getLockFrameType(header: string): LockFrameType {
  switch (header) {
    // 80 对应状态查询反馈。
    case '80':
      return 'status-query-feedback'
    // 81 对应主动状态上报。
    case '81':
      return 'manual-status-report'
    // 8A 对应开锁反馈。
    case '8A':
      return 'open-lock-feedback'
    // 9A 对应开启长通电反馈。
    case '9A':
      return 'enable-hold-feedback'
    // 9B 对应关闭长通电反馈。
    case '9B':
      return 'disable-hold-feedback'
    // 其它头统一算未知。
    default:
      return 'unknown'
  }
}

// 从缓冲里找到一个已知响应头的起始位置，用于固定长度拆帧。
function findFixedFrameHeadIndex(buffer: string, rules: readonly LockFixedLengthResponseRule[]) {
  // 以 1 字节为步长扫描整个缓冲。
  for (let index = 0; index <= buffer.length - 2; index += 2) {
    // 取当前位置的 1 字节作为候选头。
    const head = buffer.slice(index, index + 2)
    // 命中任意规则的响应头就返回索引。
    if (rules.some((rule) => rule.responseHead === head)) {
      return index
    }
  }
  // 完全找不到则返回 -1。
  return -1
}

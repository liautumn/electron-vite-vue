import { guoxinSingleDevice } from './GuoXinSingleDevice'
import {
  antsToHexMask,
  calcMatchBitLength,
  calculateDataLength,
  IRFIDTagReadMessage,
  normalizeHex,
  ControlWordParams,
  generateControlWord,
  crc16Ccitt,
  toHex
} from './GuoXinCommon'
import {
  configPowerParseFrame,
  configEPCBasebandParamParseFrame,
  lockRfidParseFrame,
  readAllAntOutputPowerParseFrame,
  readEPCContinuousParseFrame,
  readEPCParseFrame,
  stopReadEPCParseFrame,
  updateEPCPasswordParseFrame,
  writeEPCParseFrame
} from './GuoXinParseFrame'

const baseControlWordParams: Omit<ControlWordParams, 'messageId'> = {
  protocolType: 0,
  protocolVersion: 1,
  rs485Flag: 0,
  uploadFlag: 0,
  messageCategory: 2
}

const MESSAGE_ID = {
  CONFIG_POWER: 0x01,
  READ_ALL_POWER: 0x02,
  CONFIG_BASEBAND: 0x0b,
  READ_EPC: 0x10,
  WRITE_EPC: 0x11,
  LOCK_RFID: 0x12,
  STOP_READ_EPC: 0xff
} as const

const INVENTORY_CONFIG = '02 00 06'

type FirstWriteLockStep = {
  lockGoal: number
  msg: string
  successMsg: string
}

export interface WriteEPCFirstTimeOptions {
  ants: number[]
  newData: string
  tid: string
  accessPassword: string
  oldAccessPassword: string
  killPassword: string
  sessionId?: number
  onProgress?: (message: string) => void
}

const FIRST_WRITE_LOCK_STEPS: FirstWriteLockStep[] = [
  { lockGoal: 0, msg: '锁灭活密码区失败', successMsg: '锁灭活密码区成功' },
  { lockGoal: 1, msg: '锁认证密码区失败', successMsg: '锁认证密码区成功' },
  { lockGoal: 2, msg: '锁EPC区失败', successMsg: '锁EPC区成功' },
  { lockGoal: 4, msg: '锁用户数据区失败', successMsg: '锁用户数据区成功' }
]

const buildControlWord = (messageId: number) =>
  generateControlWord({
    ...baseControlWordParams,
    messageId
  }).hex

const sendFrame = (frame: string, sessionId?: number) => {
  guoxinSingleDevice.sendMessageNew(frame, sessionId)
}

function buildFrame(messageId: number, payload = '') {
  const controlWord = buildControlWord(messageId)
  const data = normalizeHex(payload)
  const length = data ? calculateDataLength(data, 4).hexLength : '0000'
  const crcSource = data ? `${controlWord}${length}${data}` : `${controlWord}${length}`
  const crc = crc16Ccitt(crcSource)

  return `5A${controlWord}${length}${data}${crc}`
}

function buildInventoryPayload(ants: number[], continuous: boolean) {
  const antMask = antsToHexMask(ants)
  const continuousFlag = continuous ? '01' : '00'
  return normalizeHex(`${antMask} ${continuousFlag} ${INVENTORY_CONFIG}`)
}

function buildTidSelectBlock(tid: string) {
  const tidLength = calcMatchBitLength(tid).hexField
  const data = normalizeHex(`02 0000 ${tidLength} ${tid}`)

  return {
    data,
    length: calculateDataLength(data, 4).hexLength
  }
}

function validatePower(power: number, antenna: number) {
  if (!Number.isInteger(power) || power < 0 || power > 33) {
    throw new Error(`天线 ${antenna} 功率必须是 0~33 的整数`)
  }
}

function buildPowerPayload(powerLevels: number[], antNum: number) {
  if (powerLevels.length < antNum) {
    throw new Error(`请提供 ${antNum} 个天线功率值`)
  }

  return Array.from({ length: antNum }, (_, index) => {
    const antenna = index + 1
    const power = powerLevels[index]
    validatePower(power, antenna)
    return `${toHex(antenna)}${toHex(power)}`
  }).join('')
}

export function readEPC(
  ants: number[],
  callback: (data: IRFIDTagReadMessage | null) => void,
  sessionId?: number
) {
  const payload = buildInventoryPayload(ants, false)
  const frame = buildFrame(MESSAGE_ID.READ_EPC, payload)

  return new Promise<string | null>((resolve, reject) => {
    try {
      readEPCParseFrame(
        (tagData) => {
          callback(tagData)
        },
        (reason) => {
          resolve(reason)
        },
        () => {
          sendFrame(frame, sessionId)
        },
        sessionId
      )
    } catch (error) {
      reject(error)
    }
  })
}

export function readEPCContinuous(
  ants: number[],
  callback: (data: IRFIDTagReadMessage | null) => void,
  sessionId?: number
) {
  const payload = buildInventoryPayload(ants, true)
  const frame = buildFrame(MESSAGE_ID.READ_EPC, payload)

  return readEPCContinuousParseFrame(
    (tagData) => {
      callback(tagData)
    },
    () => {
      sendFrame(frame, sessionId)
    },
    sessionId
  )
}

export async function stopReadEPC(sessionId?: number): Promise<void> {
  const frame = buildFrame(MESSAGE_ID.STOP_READ_EPC)
  return stopReadEPCParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

/**
 * 设置天线功率。
 * @param powerLevels 每个天线的功率数组，索引 0 对应天线 1
 */
export async function configPower(powerLevels: number[], sessionId?: number): Promise<void> {
  const antNum = guoxinSingleDevice.getAntNum(sessionId)
  const payload = buildPowerPayload(powerLevels, antNum)
  const frame = buildFrame(MESSAGE_ID.CONFIG_POWER, payload)

  return configPowerParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

export async function readAllAntOutputPower(sessionId?: number): Promise<number[]> {
  const frame = buildFrame(MESSAGE_ID.READ_ALL_POWER)
  return readAllAntOutputPowerParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// ants 天线数组
// lockGoal: 0， 灭活密码区 1， 访问密码区 2，EPC 区  3，TID 区 4，用户数据区
// lockType: 0， 解锁 1， 锁定 2， 永久解锁 3， 永久锁定
// tid: 匹配数据内容 tid
// accessPassword: 标签访问密码
export async function lockRfid(
  ants: number[],
  lockGoal: number,
  lockType: number,
  tid: string,
  accessPassword: string,
  sessionId?: number
): Promise<void> {
  const antMask = antsToHexMask(ants)
  const lockGoalHex = toHex(lockGoal)
  const lockTypeHex = toHex(lockType)
  const select = buildTidSelectBlock(tid)

  const payload = normalizeHex(
    `${antMask} ${lockGoalHex} ${lockTypeHex} 01 ${select.length} ${select.data} 02 ${accessPassword}`
  )
  const frame = buildFrame(MESSAGE_ID.LOCK_RFID, payload)

  console.log('lockRfid:', frame)

  return lockRfidParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// newData: 待写入数据
// tid: 匹配数据内容 tid
// accessPassword: 密码
export async function writeEPC(
  ants: number[],
  newData: string,
  tid: string,
  accessPassword: string,
  sessionId?: number
): Promise<void> {
  const antMask = antsToHexMask(ants)
  const writeData = normalizeHex(`3400${newData}`)
  const writeDataLength = calculateDataLength(writeData, 4).hexLength
  const select = buildTidSelectBlock(tid)

  const payload = normalizeHex(
    `${antMask} 01 0001 ${writeDataLength} ${writeData} 01 ${select.length} ${select.data} 02 ${accessPassword}`
  )
  const frame = buildFrame(MESSAGE_ID.WRITE_EPC, payload)

  console.log('writeEPC:', frame)

  return writeEPCParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

// accessPassword: 新认证密码
// killPassword: 销毁密码
// oldAccessPassword: 旧密码
// tid: 匹配数据内容 tid
export async function updateEPCPassword(
  ants: number[],
  accessPassword: string,
  killPassword: string,
  oldAccessPassword: string,
  tid: string,
  sessionId?: number
): Promise<void> {
  const antMask = antsToHexMask(ants)
  const reservedData = normalizeHex(`${killPassword}${accessPassword}`)
  const reservedLength = calculateDataLength(reservedData, 4).hexLength
  const select = buildTidSelectBlock(tid)

  const payload = normalizeHex(
    `${antMask} 00 0000 ${reservedLength} ${reservedData} 01 ${select.length} ${select.data} 02 ${oldAccessPassword}`
  )
  const frame = buildFrame(MESSAGE_ID.WRITE_EPC, payload)

  console.log('updateEPCPassword:', frame)

  return updateEPCPasswordParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

export async function writeEPCFirstTime(options: WriteEPCFirstTimeOptions) {
  const {
    ants,
    newData,
    tid,
    accessPassword,
    oldAccessPassword,
    killPassword,
    sessionId,
    onProgress
  } = options

  await updateEPCPassword(ants, accessPassword, killPassword, oldAccessPassword, tid, sessionId)
  onProgress?.('修改密码成功')

  const lockType = 1
  for (const step of FIRST_WRITE_LOCK_STEPS) {
    await lockRfid(ants, step.lockGoal, lockType, tid, accessPassword, sessionId)
    onProgress?.(step.successMsg)
  }

  await writeEPC(ants, newData, tid, accessPassword, sessionId)
  onProgress?.('写EPC成功')

  return true
}

// epcBasebandRate: EPC 基带速率
// defaultQ: 默认 Q 值
// session: Session 参数
// inventoryFlag: 盘存标志参数
export async function configEPCBasebandParam(
  epcBasebandRate = 0x01,
  defaultQ = 0x04,
  session = 0x02,
  inventoryFlag = 0x00,
  sessionId?: number
): Promise<void> {
  const payload = normalizeHex(
    `01 ${toHex(epcBasebandRate)} 02 ${toHex(defaultQ)} 03 ${toHex(session)} 04 ${toHex(inventoryFlag)}`
  )
  const frame = buildFrame(MESSAGE_ID.CONFIG_BASEBAND, payload)

  console.log('configEPCBasebandParam:', frame)

  return configEPCBasebandParamParseFrame(() => sendFrame(frame, sessionId), sessionId)
}

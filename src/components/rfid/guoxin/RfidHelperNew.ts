import { ControlWordParams, generateControlWord } from './ProtocolControlWords'
import { guoxinSingleDevice } from './GuoxinSingleDevice'
import { crc16Ccitt } from './protocolFrames'
import {
  antsToHexMask,
  calcMatchBitLength,
  calculateDataLength,
  IRFIDTagReadMessage,
  normalizeHex
} from './commonUtils'
import {
  configEPCBasebandParamParseFrame,
  lockRfidParseFrame,
  readAllAntOutputPowerParseFrame,
  readEPCContinuousParseFrame,
  readEPCParseFrame,
  updateEPCPasswordParseFrame,
  writeEPCParseFrame
} from './parseFrame'

const params: ControlWordParams = {
  protocolType: 0,
  protocolVersion: 1,
  rs485Flag: 0,
  uploadFlag: 0,
  messageCategory: 2,
  messageId: 0
}

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
  onProgress?: (message: string) => void
}

const FIRST_WRITE_LOCK_STEPS: FirstWriteLockStep[] = [
  { lockGoal: 0, msg: '锁灭活密码区失败', successMsg: '锁灭活密码区成功' },
  { lockGoal: 1, msg: '锁认证密码区失败', successMsg: '锁认证密码区成功' },
  { lockGoal: 2, msg: '锁EPC区失败', successMsg: '锁EPC区成功' },
  { lockGoal: 4, msg: '锁用户数据区失败', successMsg: '锁用户数据区成功' }
]

export function readEPC(
  ants: number[],
  callback: (data: any) => void,
  // timeoutMs: number = 1000
) {
  return new Promise<string | null>((resolve, reject) => {
    try {
      // 协议控制字
      params.messageId = 0x10
      const controlWord = generateControlWord(params).hex
      // 动态生成 ants（4 字节）
      const antsMask = antsToHexMask(ants)
      const isConti = '00' //单次读取

      //超时时间
      // const buf = Buffer.alloc(4)
      // buf.writeUInt32BE(timeoutMs)

      // const data = normalizeHex(`${antsMask} ${isConti} 02 00 06 17 ${buf.toString('hex')}`)
      const data = normalizeHex(`${antsMask} ${isConti} 02 00 06`)

      const length = calculateDataLength(data, 4).hexLength
      const crc = crc16Ccitt(`${controlWord}${length}${data}`)
      const frame = `5A${controlWord}${length}${data}${crc}`
      guoxinSingleDevice.sendMessageNew(frame)
      readEPCParseFrame(
        (data: IRFIDTagReadMessage | null) => {
          callback(data)
        },
        (res: string | null) => {
          resolve(res)
        }
      )
    } catch (error) {
      reject(error)
    }
  })
}

export function readEPCContinuous(ants: number[], callback: (data: any) => void) {
  // 协议控制字
  params.messageId = 0x10
  const controlWord = generateControlWord(params).hex
  // 动态生成 ants（4 字节）
  const antMask = antsToHexMask(ants)
  const isConti = '01' //连续读取
  const data = normalizeHex(`${antMask} ${isConti} 02 00 06`)
  const length = calculateDataLength(data, 4).hexLength
  const crc = crc16Ccitt(`${controlWord}${length}${data}`)
  const frame = `5A${controlWord}${length}${data}${crc}`
  guoxinSingleDevice.sendMessageNew(frame)
  return readEPCContinuousParseFrame((data: IRFIDTagReadMessage | null) => {
    callback(data)
  })
}

export function stopReadEPC() {
  return new Promise<void>((resolve, reject) => {
    try {
      // 协议控制字
      params.messageId = 0xff
      const controlWord = generateControlWord(params).hex
      const length = '0000'
      const crc = crc16Ccitt(`${controlWord}${length}`)
      const frame = `5A${controlWord}${length}${crc}`
      guoxinSingleDevice.sendMessageNew(frame)
      //停止监听
      guoxinSingleDevice.off('data_new')
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * 设置天线的功率
 * @param {number} readWriteIndex 读写天线索引
 * @param {number} readWritePower 0~33 功率
 * @param {number} otherPower 0~33 功率
 */
export function configPower(
  readWriteIndex: number,
  readWritePower: number,
  otherPower: number
) {
  return new Promise<void>((resolve, reject) => {
    try {
      // 协议控制字
      params.messageId = 0x01
      const controlWord = generateControlWord(params).hex
      let result = ''
      for (let i = 1; i <= guoxinSingleDevice.ant_type; i++) {
        const antennaHex = i.toString(16).padStart(2, '0').toUpperCase()
        const power = i === readWriteIndex ? readWritePower : otherPower
        const powerHex = power.toString(16).padStart(2, '0').toUpperCase()
        result += antennaHex + powerHex
      }
      const length = calculateDataLength(result, 4).hexLength
      const crc = crc16Ccitt(`${controlWord}${length}${result}`)
      const frame = `5A${controlWord}${length}${result}${crc}`
      guoxinSingleDevice.sendMessageNew(frame)
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

export function readAllAntOutputPower(callback: (data: any) => void) {
  return new Promise<void>((resolve, reject) => {
    try {
      // 协议控制字
      params.messageId = 0x02
      const controlWord = generateControlWord(params).hex
      const length = '0000'
      const crc = crc16Ccitt(`${controlWord}${length}`)
      const frame = `5A${controlWord}${length}${crc}`
      guoxinSingleDevice.sendMessageNew(frame)
      readAllAntOutputPowerParseFrame(
        (data) => {
          callback(data)
          resolve()
        },
        (res) => {
          reject(res)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

// ants 天线数组
// lockGoal: 0， 灭活密码区 1， 访问密码区 2，EPC 区  3，TID 区 4，用户数据区
// lockType: 0， 解锁 1， 锁定 2， 永久解锁 3， 永久锁定
// tid: 匹配数据内容 tid
// accessPassword: 标签访问密码
export function lockRfid(
  ants: number[],
  lockGoal: number,
  lockType: number,
  tid: string,
  accessPassword: string
) {
  return new Promise<boolean>((resolve, reject) => {
    try {
      // 协议控制字
      params.messageId = 0x12
      const controlWord = generateControlWord(params).hex
      const antMask = antsToHexMask(ants) //天线
      const lockType1 = lockType.toString(16).padStart(2, '0').toUpperCase() //类型
      const lockGoal1 = lockGoal.toString(16).padStart(2, '0').toUpperCase() //lockGoal
      const tidLength = calcMatchBitLength(tid).hexField
      const data1 = normalizeHex(`02 0000 ${tidLength} ${tid}`)
      const data1Length = calculateDataLength(data1, 4).hexLength
      const data = normalizeHex(
        `${antMask} ${lockGoal1} ${lockType1} 01 ${data1Length} ${data1} 02 ${accessPassword}`
      )
      const length = calculateDataLength(data, 4).hexLength
      const crc = crc16Ccitt(`${controlWord}${length}${data}`)
      const frame = `5A${controlWord}${length}${data}${crc}`
      console.log('lockRfid: ', frame)
      guoxinSingleDevice.sendMessageNew(frame)
      lockRfidParseFrame(
        (data) => {
          resolve(data)
        },
        (res) => {
          reject(res)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

// newData: 待写入数据
// tid: 匹配数据内容 tid
// accessPassword: 密码
export function writeEPC(
  ants: number[],
  newData: string,
  tid: string,
  accessPassword: string
) {
  return new Promise<boolean>((resolve, reject) => {
    try {
      // 协议控制字
      params.messageId = 0x11
      const controlWord = generateControlWord(params).hex
      const antsMask = antsToHexMask(ants) //天线
      const newDataLength = calculateDataLength(`3400${newData}`, 4).hexLength
      const tidLength = calcMatchBitLength(tid).hexField
      const data2 = normalizeHex(`02 0000 ${tidLength} ${tid}`)
      const data2Length = calculateDataLength(data2, 4).hexLength
      const data = normalizeHex(
        `${antsMask} 01 0001 ${newDataLength} 3400${newData} 01 ${data2Length} ${data2} 02 ${accessPassword}`
      )
      const length = calculateDataLength(data, 4).hexLength
      const crc = crc16Ccitt(`${controlWord}${length}${data}`)
      const frame = `5A${controlWord}${length}${data}${crc}`
      console.log('writeEPC: ', frame)
      guoxinSingleDevice.sendMessageNew(frame)
      writeEPCParseFrame(
        (data) => {
          resolve(data)
        },
        (res) => {
          reject(res)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

// accessPassword: 新认证密码
// killPassword: 销毁密码
// oldAccessPassword: 旧密码
// tid: 匹配数据内容 tid
export function updateEPCPassword(
  ants: number[],
  accessPassword: string,
  killPassword: string,
  oldAccessPassword: string,
  tid: string
) {
  return new Promise<boolean>((resolve, reject) => {
    try {
      // 协议控制字
      params.messageId = 0x11
      const controlWord = generateControlWord(params).hex
      const antMask = antsToHexMask(ants) //天线
      const reserverLength = calculateDataLength(`${killPassword}${accessPassword}`, 4).hexLength
      const tidLength = calcMatchBitLength(tid).hexField
      const data2 = `02 0000 ${tidLength} ${tid}`.replace(/\s+/g, '')
      const data2Length = calculateDataLength(data2, 4).hexLength
      const data = normalizeHex(
        `${antMask} 00 0000 ${reserverLength} ${killPassword}${accessPassword} 01 ${data2Length} ${data2} 02 ${oldAccessPassword}`
      )
      const length = calculateDataLength(data, 4).hexLength
      const crc = crc16Ccitt(`${controlWord}${length}${data}`)
      const frame = `5A${controlWord}${length}${data}${crc}`
      console.log('updateEPCPassword: ', frame)
      guoxinSingleDevice.sendMessageNew(frame)
      updateEPCPasswordParseFrame(
        (data) => {
          resolve(data)
        },
        (res) => {
          reject(res)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

export async function writeEPCFirstTime(options: WriteEPCFirstTimeOptions) {
  const {
    ants,
    newData,
    tid,
    accessPassword,
    oldAccessPassword,
    killPassword,
    onProgress
  } = options

  const updateOk = await updateEPCPassword(
    ants,
    accessPassword,
    killPassword,
    oldAccessPassword,
    tid
  )
  if (!updateOk) {
    throw new Error('修改密码失败')
  }
  onProgress?.('修改密码成功')

  const lockType = 1
  for (const step of FIRST_WRITE_LOCK_STEPS) {
    const lockOk = await lockRfid(ants, step.lockGoal, lockType, tid, accessPassword)
    if (!lockOk) {
      throw new Error(step.msg)
    }
    onProgress?.(step.successMsg)
  }

  const writeOk = await writeEPC(ants, newData, tid, accessPassword)
  if (!writeOk) {
    throw new Error('写EPC失败')
  }
  onProgress?.('写EPC成功')

  return true
}

// epcBasebandRate: EPC 基带速率
// defaultQ: 默认 Q 值
// session: Session 参数
// inventoryFlag: 盘存标志参数
export function configEPCBasebandParam(
  epcBasebandRate: number = 0x01,
  defaultQ: number = 0x04,
  session: number = 0x02,
  inventoryFlag: number = 0x00
) {
  return new Promise<boolean>((resolve, reject) => {
    try {
      const toHexByte = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
      // 协议控制字
      params.messageId = 0x0b
      const controlWord = generateControlWord(params).hex
      const data = normalizeHex(
        `01 ${toHexByte(epcBasebandRate)} 02 ${toHexByte(defaultQ)} 03 ${toHexByte(session)} 04 ${toHexByte(inventoryFlag)}`
      )
      const length = calculateDataLength(data, 4).hexLength
      const crc = crc16Ccitt(`${controlWord}${length}${data}`)
      const frame = `5A${controlWord}${length}${data}${crc}`
      console.log('configEPCBasebandParam: ', frame)
      guoxinSingleDevice.sendMessageNew(frame)
      configEPCBasebandParamParseFrame(
        (data) => {
          resolve(data)
        },
        (res) => {
          reject(res)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

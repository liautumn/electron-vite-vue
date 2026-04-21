import {
  extractPowerValues,
  getEPCBasebandParamConfigDesc,
  getLockResultDesc,
  getPowerConfigDesc,
  getReadDesc,
  getStopReadDesc,
  getWriteResultDesc,
  IRFIDTagReadMessage,
  parseEPCMessage,
  parseFrame
} from './GuoXinCommon'

import { guoxinSingleDevice } from './GuoXinSingleDevice'

type SendAction = () => void

interface SingleResponseOptions<T> {
  mid: string
  timeoutMs: number
  timeoutMessage: string
  parsePayload: (payload: string, rawData: string) => T
  send?: SendAction
  sessionId?: number
}

const SUCCESS_PAYLOAD = '00'

function resolveSessionId(sessionId?: number) {
  return sessionId ?? guoxinSingleDevice.currentSessionId
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function ensureSuccessPayload(payload: string, getDesc: (payload: string) => string) {
  if (payload === SUCCESS_PAYLOAD) {
    return
  }

  throw new Error(getDesc(payload))
}

function getMid(frame: Record<string, unknown>) {
  return String(frame.mid ?? '')
}

function getPayload(frame: Record<string, unknown>) {
  return String(frame.payload ?? '')
}

function waitForSingleResponse<T>(options: SingleResponseOptions<T>): Promise<T> {
  const { mid, timeoutMs, timeoutMessage, parsePayload, send, sessionId } = options
  const targetSessionId = resolveSessionId(sessionId)

  return new Promise<T>((resolve, reject) => {
    const handler = (data: string) => {
      try {
        const frame = parseFrame(data)
        if (getMid(frame) !== mid) {
          return
        }

        cleanup()
        resolve(parsePayload(getPayload(frame), data))
      } catch (error) {
        cleanup()
        reject(toError(error))
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      console.warn(timeoutMessage)
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      guoxinSingleDevice.off('GuoXin_Data', handler, targetSessionId)
    }

    guoxinSingleDevice.on('GuoXin_Data', handler, targetSessionId)

    if (!send) {
      return
    }

    try {
      send()
    } catch (error) {
      cleanup()
      reject(toError(error))
    }
  })
}

export function configPowerParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    mid: '0x01',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for configPowerParseFrame',
    send,
    sessionId,
    parsePayload: (payload) => ensureSuccessPayload(payload, getPowerConfigDesc)
  })
}

export function stopReadEPCParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    mid: '0xFF',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for stopReadEPCParseFrame',
    send,
    sessionId,
    parsePayload: (payload) => ensureSuccessPayload(payload, getStopReadDesc)
  })
}

export function readAllAntOutputPowerParseFrame(send?: SendAction, sessionId?: number) {
  return waitForSingleResponse<number[]>({
    mid: '0x02',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for readAllAntOutputPowerParseFrame',
    send,
    sessionId,
    parsePayload: (payload) => extractPowerValues(payload)
  })
}

export function readEPCParseFrame(
  onData: (data: IRFIDTagReadMessage) => void,
  onDone: (reason: string) => void,
  send?: SendAction,
  sessionId?: number
) {
  const targetSessionId = resolveSessionId(sessionId)

  const handler = (rawData: string) => {
    let frame: Record<string, unknown>

    try {
      frame = parseFrame(rawData)
    } catch (error) {
      cleanup()
      onDone(toError(error).message)
      return
    }

    const mid = getMid(frame)
    const payload = getPayload(frame)

    if (mid === '0x00') {
      const tagData = parseEPCMessage(payload)
      if (tagData) {
        onData(tagData)
      }
      return
    }

    if (mid !== '0x01') {
      return
    }

    cleanup()
    onDone(getReadDesc(payload) || '读卡结束')
  }

  const timer = setTimeout(() => {
    cleanup()
    const timeoutMessage = 'Timeout waiting for readEPCParseFrame'
    console.warn(timeoutMessage)
    onDone(timeoutMessage)
  }, 5000)

  const cleanup = () => {
    clearTimeout(timer)
    guoxinSingleDevice.off('GuoXin_Data', handler, targetSessionId)
  }

  guoxinSingleDevice.on('GuoXin_Data', handler, targetSessionId)

  if (!send) {
    return
  }

  try {
    send()
  } catch (error) {
    cleanup()
    throw toError(error)
  }
}

export function readEPCContinuousParseFrame(
  callback: (data: IRFIDTagReadMessage | null) => void,
  send?: SendAction,
  sessionId?: number
) {
  const targetSessionId = resolveSessionId(sessionId)

  const handler = (rawData: string) => {
    try {
      const frame = parseFrame(rawData)
      if (getMid(frame) !== '0x00') {
        return
      }

      callback(parseEPCMessage(getPayload(frame)))
    } catch (error) {
      console.warn('readEPCContinuousParseFrame parse error:', toError(error).message)
    }
  }

  guoxinSingleDevice.on('GuoXin_Data', handler, targetSessionId)

  if (send) {
    try {
      send()
    } catch (error) {
      guoxinSingleDevice.off('GuoXin_Data', handler, targetSessionId)
      throw toError(error)
    }
  }

  return () => {
    guoxinSingleDevice.off('GuoXin_Data', handler, targetSessionId)
  }
}

export function lockRfidParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    mid: '0x12',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for lockRfidParseFrame',
    send,
    sessionId,
    parsePayload: (payload, rawData) => {
      console.log('lockRfidParseFrame:', rawData)
      ensureSuccessPayload(payload, getLockResultDesc)
    }
  })
}

export function writeEPCParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    mid: '0x11',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for writeEPCParseFrame',
    send,
    sessionId,
    parsePayload: (payload, rawData) => {
      console.log('writeEPCParseFrame:', rawData)
      ensureSuccessPayload(payload, getWriteResultDesc)
    }
  })
}

export function updateEPCPasswordParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    mid: '0x11',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for updateEPCPasswordParseFrame',
    send,
    sessionId,
    parsePayload: (payload, rawData) => {
      console.log('updateEPCPasswordParseFrame:', rawData)
      ensureSuccessPayload(payload, getWriteResultDesc)
    }
  })
}

export function configEPCBasebandParamParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    mid: '0x0B',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for configEPCBasebandParamParseFrame',
    send,
    sessionId,
    parsePayload: (payload, rawData) => {
      console.log('configEPCBasebandParamParseFrame:', rawData)
      ensureSuccessPayload(payload, getEPCBasebandParamConfigDesc)
    }
  })
}

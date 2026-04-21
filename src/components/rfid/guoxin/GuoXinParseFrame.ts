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

function waitForSingleResponse<T>(options: SingleResponseOptions<T>): Promise<T> {
  const { mid, timeoutMs, timeoutMessage, parsePayload, send, sessionId } = options
  const targetSessionId = sessionId ?? guoxinSingleDevice.currentSessionId

  return new Promise<T>((resolve, reject) => {
    const handler = (data: string) => {
      try {
        const res = parseFrame(data)
        if (res.mid !== mid) {
          return
        }
        cleanup()
        resolve(parsePayload((res.payload ?? '') as string, data))
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      console.warn(timeoutMessage)
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      guoxinSingleDevice.off('GuoXin_Data', handler, targetSessionId)
    }

    guoxinSingleDevice.on('GuoXin_Data', handler, targetSessionId)

    if (send) {
      try {
        send()
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
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
    parsePayload: (payload) => {
      if (payload !== '00') {
        throw new Error(getPowerConfigDesc(payload))
      }
    }
  })
}

export function stopReadEPCParseFrame(send?: SendAction, sessionId?: number): Promise<void> {
  return waitForSingleResponse<void>({
    mid: '0xFF',
    timeoutMs: 3000,
    timeoutMessage: 'Timeout waiting for stopReadEPCParseFrame',
    send,
    sessionId,
    parsePayload: (payload) => {
      if (payload !== '00') {
        throw new Error(getStopReadDesc(payload))
      }
    }
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
  const targetSessionId = sessionId ?? guoxinSingleDevice.currentSessionId

  const handler = (data: string) => {
    const res = parseFrame(data)

    if (res.mid === '0x00') {
      const resp = parseEPCMessage(res.payload as string)
      if (resp) {
        onData(resp)
      }
    }

    if (res.mid === '0x01') {
      const desc = getReadDesc(res.payload as string)
      cleanup()
      onDone(desc ?? '读卡结束')
    }
  }

  const timer = setTimeout(() => {
    cleanup()
    console.warn('Timeout waiting for readEPCParseFrame')
    onDone('Timeout waiting for readEPCParseFrame')
  }, 5000)

  function cleanup() {
    clearTimeout(timer)
    guoxinSingleDevice.off('GuoXin_Data', handler, targetSessionId)
  }

  guoxinSingleDevice.on('GuoXin_Data', handler, targetSessionId)

  if (send) {
    try {
      send()
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

export function readEPCContinuousParseFrame(
  callback: (data: IRFIDTagReadMessage | null) => void,
  send?: SendAction,
  sessionId?: number
) {
  const targetSessionId = sessionId ?? guoxinSingleDevice.currentSessionId

  const handler = (res: string) => {
    const parsed = parseFrame(res)
    if (parsed.mid === '0x00') {
      const payload = parsed.payload ?? ''
      const resp = parseEPCMessage(payload as string)
      callback(resp)
    }
  }

  guoxinSingleDevice.on('GuoXin_Data', handler, targetSessionId)

  if (send) {
    try {
      send()
    } catch (error) {
      guoxinSingleDevice.off('GuoXin_Data', handler, targetSessionId)
      throw error
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
      console.log('lockRfidParseFrame: ', rawData)
      if (payload !== '00') {
        throw new Error(getLockResultDesc(payload))
      }
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
      console.log('writeEPCParseFrame: ', rawData)
      if (payload !== '00') {
        throw new Error(getWriteResultDesc(payload))
      }
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
      console.log('updateEPCPasswordParseFrame: ', rawData)
      if (payload !== '00') {
        throw new Error(getWriteResultDesc(payload))
      }
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
      console.log('configEPCBasebandParamParseFrame: ', rawData)
      if (payload !== '00') {
        throw new Error(getEPCBasebandParamConfigDesc(payload))
      }
    }
  })
}

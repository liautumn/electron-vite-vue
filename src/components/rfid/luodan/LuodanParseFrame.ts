import {
  parseLuodanInventoryMessage,
  type LuodanInventoryMessage
} from './LuodanCommon'
import { luodanDevice } from './LuodanDevice'

type SendAction = () => void

function resolveSessionId(sessionId?: number) {
  return sessionId ?? luodanDevice.currentSessionId
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

export function readEPCPhaseParseFrame(
  callback: (data: LuodanInventoryMessage) => void,
  send?: SendAction,
  sessionId?: number
) {
  const targetSessionId = resolveSessionId(sessionId)

  const handler = (rawData: string) => {
    try {
      const message = parseLuodanInventoryMessage(rawData, { phaseEnabled: true })
      if (message) {
        callback(message)
      }
    } catch (error) {
      console.warn('readEPCPhaseParseFrame parse error:', toError(error).message)
    }
  }

  luodanDevice.on(handler, targetSessionId)

  if (send) {
    try {
      send()
    } catch (error) {
      luodanDevice.off(handler, targetSessionId)
      throw toError(error)
    }
  }

  return () => {
    luodanDevice.off(handler, targetSessionId)
  }
}

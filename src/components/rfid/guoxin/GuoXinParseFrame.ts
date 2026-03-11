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

import {guoxinSingleDevice} from './GuoXinSingleDevice'

type SendAction = () => void

interface SingleResponseOptions<T> {
    mid: string
    timeoutMs: number
    timeoutMessage: string
    parsePayload: (payload: string, rawData: string) => T
    send?: SendAction
}

function waitForSingleResponse<T>(options: SingleResponseOptions<T>): Promise<T> {
    const {mid, timeoutMs, timeoutMessage, parsePayload, send} = options

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
            guoxinSingleDevice.off('guoxin_data', handler)
        }

        guoxinSingleDevice.on('guoxin_data', handler)

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

export function configPowerParseFrame(send?: SendAction): Promise<void> {
    return waitForSingleResponse<void>({
        mid: '0x01',
        timeoutMs: 3000,
        timeoutMessage: 'Timeout waiting for configPowerParseFrame',
        send,
        parsePayload: (payload) => {
            if (payload !== '00') {
                throw new Error(getPowerConfigDesc(payload))
            }
        }
    })
}

export function stopReadEPCParseFrame(send?: SendAction): Promise<void> {
    return waitForSingleResponse<void>({
        mid: '0xFF',
        timeoutMs: 3000,
        timeoutMessage: 'Timeout waiting for stopReadEPCParseFrame',
        send,
        parsePayload: (payload) => {
            if (payload !== '00') {
                throw new Error(getStopReadDesc(payload))
            }
        }
    })
}

export function readAllAntOutputPowerParseFrame(send?: SendAction) {
    return waitForSingleResponse<number[]>({
        mid: '0x02',
        timeoutMs: 3000,
        timeoutMessage: 'Timeout waiting for readAllAntOutputPowerParseFrame',
        send,
        parsePayload: (payload) => extractPowerValues(payload)
    })
}

export function readEPCParseFrame(
    onData: (data: IRFIDTagReadMessage) => void,
    onDone: (reason: string) => void,
    send?: SendAction
) {
    const handler = (data: any) => {
        console.log(data)
        const res = parseFrame(data)
        // EPC 数据上报
        if (res.mid === '0x00') {
            const resp = parseEPCMessage(res.payload as string)
            if (resp) {
                onData(resp)
            }
        }
        // 读卡结束
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
        guoxinSingleDevice.off('guoxin_data', handler)
    }

    guoxinSingleDevice.on('guoxin_data', handler)

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
    send?: SendAction
) {
    const handler = (res: any) => {
        const parsed = parseFrame(res)
        if ('0x00' === parsed.mid) {
            const payload = parsed.payload ?? ''
            const resp = parseEPCMessage(payload as string)
            callback(resp)
        }
    }

    guoxinSingleDevice.on('guoxin_data', handler)

    if (send) {
        try {
            send()
        } catch (error) {
            guoxinSingleDevice.off('guoxin_data', handler)
            throw error
        }
    }

    return () => {
        guoxinSingleDevice.off('guoxin_data', handler)
    }
}

export function lockRfidParseFrame(send?: SendAction): Promise<void> {
    return waitForSingleResponse<void>({
        mid: '0x12',
        timeoutMs: 3000,
        timeoutMessage: 'Timeout waiting for lockRfidParseFrame',
        send,
        parsePayload: (payload, rawData) => {
            console.log('lockRfidParseFrame: ', rawData)
            if (payload !== '00') {
                throw new Error(getLockResultDesc(payload))
            }
        }
    })
}

export function writeEPCParseFrame(send?: SendAction): Promise<void> {
    return waitForSingleResponse<void>({
        mid: '0x11',
        timeoutMs: 3000,
        timeoutMessage: 'Timeout waiting for writeEPCParseFrame',
        send,
        parsePayload: (payload, rawData) => {
            console.log('writeEPCParseFrame: ', rawData)
            if (payload !== '00') {
                throw new Error(getWriteResultDesc(payload))
            }
        }
    })
}

export function updateEPCPasswordParseFrame(send?: SendAction): Promise<void> {
    return waitForSingleResponse<void>({
        mid: '0x11',
        timeoutMs: 3000,
        timeoutMessage: 'Timeout waiting for updateEPCPasswordParseFrame',
        send,
        parsePayload: (payload, rawData) => {
            console.log('updateEPCPasswordParseFrame: ', rawData)
            if (payload !== '00') {
                throw new Error(getWriteResultDesc(payload))
            }
        }
    })
}

export function configEPCBasebandParamParseFrame(send?: SendAction): Promise<void> {
    return waitForSingleResponse<void>({
        mid: '0x0B',
        timeoutMs: 3000,
        timeoutMessage: 'Timeout waiting for configEPCBasebandParamParseFrame',
        send,
        parsePayload: (payload, rawData) => {
            console.log('configEPCBasebandParamParseFrame: ', rawData)
            if (payload !== '00') {
                throw new Error(getEPCBasebandParamConfigDesc(payload))
            }
        }
    })
}

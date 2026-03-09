import {
    extractPowerValues,
    getReadDesc,
    IRFIDTagReadMessage,
    parseEPCMessage,
    parseFrame
} from './CommonUtil'

import {guoxinSingleDevice} from './GuoxinSingleDevice'

export function readAllAntOutputPowerParseFrame(
    onData: (data: number[]) => void,
    onDone: (reason: string) => void
) {
    const handler = (data: any) => {
        const res = parseFrame(data)
        if (res.mid === '0x02') {
            cleanup()
            onData(extractPowerValues(res.payload as string))
        }
    }

    const timer = setTimeout(() => {
        cleanup()
        console.warn('Timeout waiting for readAllAntOutputPowerParseFrame')
        onDone('Timeout waiting for readAllAntOutputPowerParseFrame')
    }, 3000)

    function cleanup() {
        clearTimeout(timer)
        guoxinSingleDevice.off('data_new', handler)
    }

    guoxinSingleDevice.on('data_new', handler)
}

export function readEPCParseFrame(
    onData: (data: IRFIDTagReadMessage) => void,
    onDone: (reason: string) => void
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
        guoxinSingleDevice.off('data_new', handler)
    }

    guoxinSingleDevice.on('data_new', handler)
}

export function readEPCContinuousParseFrame(
    callback: (data: IRFIDTagReadMessage | null) => void
) {
    const handler = (res: any) => {
        const parsed = parseFrame(res)
        if ('0x00' === parsed.mid) {
            const payload = parsed.payload ?? ''
            const resp = parseEPCMessage(payload as string)
            callback(resp)
        }
    }

    guoxinSingleDevice.on('data_new', handler)

    return () => {
        guoxinSingleDevice.off('data_new', handler)
    }
}

export function lockRfidParseFrame(
    onData: (data: boolean) => void,
    onDone: (reason: string) => void
) {
    const handler = (data: any) => {
        const res = parseFrame(data)
        if (res.mid === '0x12') {
            console.log('lockRfidParseFrame: ', data)
            const payload = res.payload ?? ''
            cleanup()
            onData(payload === '00')
        }
    }

    const timer = setTimeout(() => {
        cleanup()
        console.warn('Timeout waiting for lockRfidParseFrame')
        onDone('Timeout waiting for lockRfidParseFrame')
    }, 3000)

    function cleanup() {
        clearTimeout(timer)
        guoxinSingleDevice.off('data_new', handler)
    }

    guoxinSingleDevice.on('data_new', handler)
}

export function writeEPCParseFrame(
    onData: (data: boolean) => void,
    onDone: (reason: string) => void
) {
    const handler = (data: any) => {
        const res = parseFrame(data)
        if (res.mid === '0x11') {
            console.log('writeEPCParseFrame: ', data)
            const payload = res.payload ?? ''
            cleanup()
            onData(payload === '00')
        }
    }
    const timer = setTimeout(() => {
        cleanup()
        console.warn('Timeout waiting for writeEPCParseFrame')
        onDone('Timeout waiting for writeEPCParseFrame')
    }, 3000)

    function cleanup() {
        clearTimeout(timer)
        guoxinSingleDevice.off('data_new', handler)
    }

    guoxinSingleDevice.on('data_new', handler)
}

export function updateEPCPasswordParseFrame(
    onData: (data: boolean) => void,
    onDone: (reason: string) => void
) {
    const handler = (data: any) => {
        const res = parseFrame(data)
        if (res.mid === '0x11') {
            console.log('updateEPCPasswordParseFrame: ', data)
            const payload = res.payload ?? ''
            cleanup()
            onData(payload === '00')
        }
    }
    const timer = setTimeout(() => {
        cleanup()
        console.warn('Timeout waiting for updateEPCPasswordParseFrame')
        onDone('Timeout waiting for updateEPCPasswordParseFrame')
    }, 3000)

    function cleanup() {
        clearTimeout(timer)
        guoxinSingleDevice.off('data_new', handler)
    }

    guoxinSingleDevice.on('data_new', handler)
}

export function configEPCBasebandParamParseFrame(
    onData: (data: boolean) => void,
    onDone: (reason: string) => void
) {
    const handler = (data: any) => {
        const res = parseFrame(data)
        if (res.mid === '0x0B') {
            console.log('configEPCBasebandParamParseFrame: ', data)
            const payload = res.payload ?? ''
            cleanup()
            onData(payload === '00')
        }
    }

    const timer = setTimeout(() => {
        cleanup()
        console.warn('Timeout waiting for configEPCBasebandParamParseFrame')
        onDone('Timeout waiting for configEPCBasebandParamParseFrame')
    }, 3000)

    function cleanup() {
        clearTimeout(timer)
        guoxinSingleDevice.off('data_new', handler)
    }

    guoxinSingleDevice.on('data_new', handler)
}

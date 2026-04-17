import {BrowserWindow, ipcMain} from 'electron'
import {connect, type IClientOptions, type MqttClient} from 'mqtt'
import {createLogger} from '../utils/logger'

type MqttQoS = 0 | 1 | 2

type MqttConnectOptions = {
    url: string
    clientId?: string
    username?: string
    password?: string
    clean?: boolean
    reconnectPeriod?: number
    connectTimeout?: number
}

type MqttSubscribeOptions = {
    topic: string
    qos?: MqttQoS
}

type MqttPublishOptions = {
    topic: string
    payload: string
    qos?: MqttQoS
    retain?: boolean
}

let client: MqttClient | null = null
let win: BrowserWindow | null = null
let mqttRegistered = false
const log = createLogger('mqtt')

const sendToRenderer = (channel: string, payload?: unknown) => {
    if (!win || win.isDestroyed()) return

    if (payload === undefined) {
        win.webContents.send(channel)
        return
    }

    win.webContents.send(channel, payload)
}

const buildClientOptions = (options: MqttConnectOptions): IClientOptions => ({
    clientId: options.clientId?.trim() || undefined,
    username: options.username?.trim() || undefined,
    password: options.password || undefined,
    clean: options.clean ?? true,
    reconnectPeriod: options.reconnectPeriod ?? 1000,
    connectTimeout: options.connectTimeout ?? 30_000,
})

const detachClient = async () => {
    const activeClient = client
    client = null

    if (!activeClient) return

    log.info('Disconnecting MQTT client')
    activeClient.removeAllListeners()

    try {
        await activeClient.endAsync(true)
    } catch {
        activeClient.end(true)
    }
}

const bindClientEvents = (target: MqttClient) => {
    target.on('connect', () => {
        log.info('MQTT connected')
        sendToRenderer('mqtt:connect')
    })

    target.on('reconnect', () => {
        log.warn('MQTT reconnecting')
        sendToRenderer('mqtt:reconnect')
    })

    target.on('offline', () => {
        log.warn('MQTT offline')
        sendToRenderer('mqtt:offline')
    })

    target.on('close', () => {
        log.info('MQTT connection closed')
        sendToRenderer('mqtt:close')
    })

    target.on('error', error => {
        log.error('MQTT client error', error)
        sendToRenderer('mqtt:error', error.message)
    })

    target.on('message', (topic, payload, packet) => {
        sendToRenderer('mqtt:message', {
            topic,
            payloadText: payload.toString(),
            payloadHex: payload.toString('hex').toUpperCase(),
            qos: packet.qos ?? 0,
            retain: Boolean(packet.retain),
            dup: Boolean(packet.dup),
            timestamp: new Date().toISOString(),
        })
    })
}

export function registerMqtt(mainWindow: BrowserWindow) {
    win = mainWindow

    if (mqttRegistered) return
    mqttRegistered = true
    log.info('MQTT IPC handlers registered')

    ipcMain.handle('mqtt:connect', async (_, options: MqttConnectOptions) => {
        const url = options.url?.trim()
        if (!url) throw new Error('MQTT Broker URL 不能为空')

        log.info('Connecting MQTT broker', {url})
        await detachClient()

        const nextClient = connect(url, buildClientOptions(options))
        bindClientEvents(nextClient)
        client = nextClient

        return true
    })

    ipcMain.handle('mqtt:disconnect', async () => {
        await detachClient()
        sendToRenderer('mqtt:close')
        return true
    })

    ipcMain.handle('mqtt:subscribe', async (_, options: MqttSubscribeOptions) => {
        if (!client) throw new Error('MQTT 未连接')

        const topic = options.topic?.trim()
        if (!topic) throw new Error('订阅 Topic 不能为空')

        log.info('Subscribing MQTT topic', {topic, qos: options.qos ?? 0})
        return await client.subscribeAsync(topic, {
            qos: options.qos ?? 0,
        })
    })

    ipcMain.handle('mqtt:unsubscribe', async (_, topic: string) => {
        if (!client) throw new Error('MQTT 未连接')

        const normalizedTopic = topic?.trim()
        if (!normalizedTopic) throw new Error('取消订阅 Topic 不能为空')

        log.info('Unsubscribing MQTT topic', {topic: normalizedTopic})
        await client.unsubscribeAsync(normalizedTopic)
        return true
    })

    ipcMain.handle('mqtt:publish', async (_, options: MqttPublishOptions) => {
        if (!client) throw new Error('MQTT 未连接')

        const topic = options.topic?.trim()
        if (!topic) throw new Error('发布 Topic 不能为空')

        log.debug('Publishing MQTT message', {
            topic,
            qos: options.qos ?? 0,
            retain: options.retain ?? false,
        })
        await client.publishAsync(topic, options.payload, {
            qos: options.qos ?? 0,
            retain: options.retain ?? false,
        })

        return true
    })
}

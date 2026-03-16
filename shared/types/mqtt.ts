export type MqttQoS = 0 | 1 | 2

export interface MqttConnectOptions {
    url: string
    clientId?: string
    username?: string
    password?: string
    clean?: boolean
    reconnectPeriod?: number
    connectTimeout?: number
}

export interface MqttSubscribeOptions {
    topic: string
    qos?: MqttQoS
}

export interface MqttPublishOptions {
    topic: string
    payload: string
    qos?: MqttQoS
    retain?: boolean
}

export interface MqttSubscriptionGrant {
    topic: string
    qos: MqttQoS | 128
}

export interface MqttMessageEvent {
    topic: string
    payloadText: string
    payloadHex: string
    qos: MqttQoS
    retain: boolean
    dup: boolean
    timestamp: string
}

export interface MqttMethods {
    connect(options: MqttConnectOptions): Promise<boolean>
    disconnect(): Promise<boolean>
    subscribe(options: MqttSubscribeOptions): Promise<MqttSubscriptionGrant[]>
    unsubscribe(topic: string): Promise<boolean>
    publish(options: MqttPublishOptions): Promise<boolean>
    onConnect(cb: () => void): () => void
    onReconnect(cb: () => void): () => void
    onOffline(cb: () => void): () => void
    onClose(cb: () => void): () => void
    onError(cb: (event: Electron.IpcRendererEvent, msg: string) => void): () => void
    onMessage(cb: (event: Electron.IpcRendererEvent, message: MqttMessageEvent) => void): () => void
}

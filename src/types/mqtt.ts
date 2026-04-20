export type MqttQoS = 0 | 1 | 2

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

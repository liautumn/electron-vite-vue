<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import type { IpcRendererEvent } from 'electron'
import type {MqttMessageEvent, MqttQoS, MqttSubscriptionGrant} from '../types/mqtt'

type SelectOption<T = string | number | boolean> = {
    label: string
    value: T
    disabled?: boolean
}

defineOptions({name: 'mqtt-demo'})

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

const qosOptions: SelectOption<MqttQoS>[] = [
    {label: 'QoS 0', value: 0},
    {label: 'QoS 1', value: 1},
    {label: 'QoS 2', value: 2},
]

const createClientId = () => `electron_vite_vue_${Math.random().toString(16).slice(2, 10)}`

const clientId = ref(createClientId())
const brokerUrl = ref('mqtt://127.0.0.1:1883')
const username = ref('')
const password = ref('')
const cleanSession = ref(true)
const reconnectPeriod = ref(1000)

const subscribeTopic = ref('test_topic')
const subscribeQos = ref<MqttQoS>(0)
const publishTopic = ref('test_topic')
const publishQos = ref<MqttQoS>(0)
const publishPayload = ref('Hello from electron-vite-vue')
const retain = ref(false)

const connectionState = ref<ConnectionState>('disconnected')
const log = ref('')
const messages = ref<MqttMessageEvent[]>([])

const isConnected = computed(() => connectionState.value === 'connected')
const messageRecordsText = computed(() => {
    if (!messages.value.length) return ''

    return JSON.stringify(
        messages.value.map(message => ({
            timestamp: message.timestamp,
            topic: message.topic,
            qos: message.qos,
            retain: message.retain,
            dup: message.dup,
            payload: tryParseJson(message.payloadText),
            payloadHex: message.payloadHex,
        })),
        null,
        2
    )
})

const statusLabel = computed(() => {
    if (connectionState.value === 'connecting') return '连接中'
    if (connectionState.value === 'connected') return '已连接'
    if (connectionState.value === 'reconnecting') return '重连中'
    if (connectionState.value === 'offline') return '离线'
    return '未连接'
})

const statusColor = computed(() => {
    if (connectionState.value === 'connected') return 'positive'
    if (connectionState.value === 'connecting') return 'primary'
    if (connectionState.value === 'reconnecting') return 'warning'
    if (connectionState.value === 'offline') return 'amber'
    return 'negative'
})

const tryParseJson = (value: string) => {
    const content = value.trim()
    if (!content) return ''

    try {
        return JSON.parse(content)
    } catch {
        return value
    }
}

const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {hour12: false})
    log.value += `[${timestamp}] ${message}\n`
}

const normalizeError = (error: unknown) => {
    if (error instanceof Error) return error.message
    return String(error)
}

const connect = async () => {
    const url = brokerUrl.value.trim()
    if (!url) {
        appendLog('请填写 Broker URL')
        return
    }

    connectionState.value = 'connecting'
    appendLog(`开始连接 Broker: ${url}`)

    try {
        await window.mqtt.connect({
            url,
            clientId: clientId.value.trim(),
            username: username.value.trim() || undefined,
            password: password.value || undefined,
            clean: cleanSession.value,
            reconnectPeriod: reconnectPeriod.value,
        })
    } catch (error) {
        connectionState.value = 'disconnected'
        appendLog(`连接请求失败: ${normalizeError(error)}`)
    }
}

const disconnect = async () => {
    try {
        await window.mqtt.disconnect()
        connectionState.value = 'disconnected'
        appendLog('已发送断开请求')
    } catch (error) {
        appendLog(`断开失败: ${normalizeError(error)}`)
    }
}

const subscribe = async () => {
    const topic = subscribeTopic.value.trim()
    if (!topic) {
        appendLog('请填写订阅 Topic')
        return
    }

    try {
        const granted = await window.mqtt.subscribe({
            topic,
            qos: subscribeQos.value,
        }) as MqttSubscriptionGrant[]
        const summary = granted.length
            ? granted.map((item) => `${item.topic} (QoS ${item.qos})`).join(', ')
            : `${topic} (QoS ${subscribeQos.value})`
        appendLog(`订阅成功: ${summary}`)
    } catch (error) {
        appendLog(`订阅失败: ${normalizeError(error)}`)
    }
}

const unsubscribe = async () => {
    const topic = subscribeTopic.value.trim()
    if (!topic) {
        appendLog('请填写取消订阅 Topic')
        return
    }

    try {
        await window.mqtt.unsubscribe(topic)
        appendLog(`取消订阅成功: ${topic}`)
    } catch (error) {
        appendLog(`取消订阅失败: ${normalizeError(error)}`)
    }
}

const publish = async () => {
    const topic = publishTopic.value.trim()
    if (!topic) {
        appendLog('请填写发布 Topic')
        return
    }

    try {
        await window.mqtt.publish({
            topic,
            payload: publishPayload.value,
            qos: publishQos.value,
            retain: retain.value,
        })
        appendLog(`发布成功: ${topic} -> ${publishPayload.value || '(empty)'}`)
    } catch (error) {
        appendLog(`发布失败: ${normalizeError(error)}`)
    }
}

const clearLog = () => {
    log.value = ''
}

const clearMessages = () => {
    messages.value = []
}

const disposers: Array<() => void> = []

onMounted(() => {
    appendLog('MQTT Demo 已就绪。')

    disposers.push(
        window.mqtt.onConnect(() => {
            connectionState.value = 'connected'
            appendLog('MQTT 已连接')
        }),
        window.mqtt.onReconnect(() => {
            connectionState.value = 'reconnecting'
            appendLog('MQTT 重连中')
        }),
        window.mqtt.onOffline(() => {
            connectionState.value = 'offline'
            appendLog('MQTT 已离线')
        }),
        window.mqtt.onClose(() => {
            connectionState.value = 'disconnected'
            appendLog('MQTT 连接已关闭')
        }),
        window.mqtt.onError((_event: IpcRendererEvent, message: string) => {
            appendLog(`MQTT 错误: ${message}`)
        }),
        window.mqtt.onMessage((_event: IpcRendererEvent, message: MqttMessageEvent) => {
            messages.value = [message, ...messages.value].slice(0, 20)
            appendLog(`收到消息: ${message.topic} -> ${message.payloadText || '(empty)'}`)
        })
    )
})

onUnmounted(() => {
    disposers.forEach(dispose => dispose())
    void window.mqtt.disconnect().catch(() => undefined)
})
</script>

<template>
  <div class="container">
    <div class="panel-grid">
      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">Broker 配置</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <q-input v-model="brokerUrl" outlined label="Broker URL" placeholder="mqtt://127.0.0.1:1883"/>

          <div class="field-grid field-grid--wide">
            <q-input v-model="clientId" outlined label="Client ID" placeholder="客户端 ID"/>
            <q-input v-model.number="reconnectPeriod" outlined type="number" label="重连间隔(ms)" min="0" step="500"/>
          </div>

          <div class="field-grid">
            <q-input v-model="username" outlined label="用户名" placeholder="可选"/>
            <q-input v-model="password" outlined type="password" label="密码" placeholder="可选"/>
          </div>

          <div class="actions-row">
            <div class="status-row">
              <q-checkbox v-model="cleanSession" label="Clean Session"/>
              <q-chip square dense :color="statusColor" text-color="white">{{ statusLabel }}</q-chip>
            </div>
            <div class="action-buttons">
              <q-btn color="primary" no-caps unelevated @click="connect">连接</q-btn>
              <q-btn color="negative" no-caps unelevated @click="disconnect">断开</q-btn>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section class="panel-title-row">
          <div class="panel-title">运行日志</div>
          <q-btn flat color="primary" no-caps @click="clearLog">清空日志</q-btn>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-fill">
          <div class="output-box output-box--fill">
            <pre class="output-content">{{ log || '连接、订阅、发布、接收日志' }}</pre>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">订阅</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack panel-stack--fill">
          <q-input v-model="subscribeTopic" outlined label="Topic" placeholder="订阅 Topic"/>
          <q-select
            v-model="subscribeQos"
            outlined
            emit-value
            map-options
            :options="qosOptions"
            label="QoS"
          />

          <div class="action-buttons">
            <q-btn color="primary" no-caps unelevated :disable="!isConnected" @click="subscribe">订阅</q-btn>
            <q-btn outline color="primary" no-caps :disable="!isConnected" @click="unsubscribe">取消订阅</q-btn>
          </div>

          <div class="panel-fill">
            <div class="output-header">
              <span class="output-title">订阅消息</span>
              <div class="action-buttons">
                <q-chip square dense color="primary" text-color="white">JSON</q-chip>
                <q-btn flat color="primary" no-caps @click="clearMessages">清空消息</q-btn>
              </div>
            </div>
            <div class="output-box output-box--fill output-box--records">
              <pre class="output-content">{{ messageRecordsText || '收到的 MQTT 消息会格式化为 JSON 输出到这里' }}</pre>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">发布</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack panel-stack--fill">
          <q-input v-model="publishTopic" outlined label="Topic" placeholder="发布 Topic"/>
          <q-input
            v-model="publishPayload"
            outlined
            autogrow
            type="textarea"
            class="payload-input"
            label="Payload"
            placeholder="消息内容"
          />
          <q-select
            v-model="publishQos"
            outlined
            emit-value
            map-options
            :options="qosOptions"
            label="QoS"
          />

          <div class="action-buttons">
            <q-checkbox v-model="retain" label="Retain"/>
            <q-btn color="primary" no-caps unelevated :disable="!isConnected" @click="publish">发布</q-btn>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
}

.panel-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.panel-card {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-title,
.panel-title-row {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  min-height: 0;
}

.panel-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.field-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field-grid--wide {
  grid-template-columns: minmax(0, 1.5fr) minmax(180px, 0.8fr);
}

.panel-stack--fill {
  flex: 1;
  min-height: 0;
}

.panel-fill {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.actions-row {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
}

.status-row,
.action-buttons {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.output-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.output-title {
  font-weight: 600;
}

.output-box {
  overflow: auto;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-surface);
  padding: 12px;
  min-height: 260px;
  max-height: 360px;
}

.output-box--fill {
  flex: 1;
}

.output-box--records {
  min-height: 220px;
  max-height: 320px;
}

.output-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  line-height: 1.5;
}

.payload-input :deep(textarea) {
  min-height: 140px;
  resize: none;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

@media (max-width: 991px) {
  .panel-grid,
  .field-grid,
  .field-grid--wide {
    grid-template-columns: 1fr;
  }
}
</style>

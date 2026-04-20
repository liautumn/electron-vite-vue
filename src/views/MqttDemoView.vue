<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import type {SelectProps} from 'ant-design-vue'
import type { IpcRendererEvent } from 'electron'
import type {MqttMessageEvent, MqttQoS, MqttSubscriptionGrant} from '../types/mqtt'

defineOptions({name: 'mqtt-demo'})

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

const qosOptions: SelectProps['options'] = [
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
    if (connectionState.value === 'connected') return 'green'
    if (connectionState.value === 'connecting') return 'blue'
    if (connectionState.value === 'reconnecting') return 'orange'
    if (connectionState.value === 'offline') return 'gold'
    return 'red'
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
    <a-row :gutter="[16, 16]" class="panel-grid">
      <a-col :xs="24" :lg="12" class="panel-col">
        <a-card title="Broker 配置" class="panel-card">
          <div class="panel-stack">
            <a-form layout="vertical">
              <a-form-item label="Broker URL">
                <a-input v-model:value="brokerUrl" placeholder="mqtt://127.0.0.1:1883"/>
              </a-form-item>
              <a-row :gutter="12">
                <a-col :span="14">
                  <a-form-item label="Client ID">
                    <a-input v-model:value="clientId" placeholder="客户端 ID"/>
                  </a-form-item>
                </a-col>
                <a-col :span="10">
                  <a-form-item label="重连间隔(ms)">
                    <a-input-number v-model:value="reconnectPeriod" :min="0" :step="500" style="width: 100%"/>
                  </a-form-item>
                </a-col>
              </a-row>
              <a-row :gutter="12">
                <a-col :span="12">
                  <a-form-item label="用户名" style="margin-bottom: 0">
                    <a-input v-model:value="username" placeholder="可选"/>
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="密码" style="margin-bottom: 0">
                    <a-input-password v-model:value="password" placeholder="可选"/>
                  </a-form-item>
                </a-col>
              </a-row>
            </a-form>

            <div class="actions-row">
              <a-space wrap>
                <a-checkbox v-model:checked="cleanSession">Clean Session</a-checkbox>
                <a-tag :color="statusColor">{{ statusLabel }}</a-tag>
              </a-space>
              <a-space wrap>
                <a-button type="primary" @click="connect">连接</a-button>
                <a-button danger @click="disconnect">断开</a-button>
              </a-space>
            </div>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="12" class="panel-col">
        <a-card title="运行日志" class="panel-card">
          <template #extra>
            <a-button size="small" @click="clearLog">清空日志</a-button>
          </template>
          <div class="panel-fill">
            <div class="output-box output-box--fill">
              <pre class="output-content">{{ log || '连接、订阅、发布、接收日志' }}</pre>
            </div>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="12" class="panel-col">
        <a-card title="订阅" class="panel-card">
          <div class="panel-stack panel-stack--fill">
            <a-form layout="vertical">
              <a-form-item label="Topic">
                <a-input v-model:value="subscribeTopic" placeholder="订阅 Topic"/>
              </a-form-item>
              <a-form-item label="QoS" style="margin-bottom: 0">
                <a-select v-model:value="subscribeQos" :options="qosOptions" style="width: 100%"/>
              </a-form-item>
            </a-form>

            <a-space wrap>
              <a-button type="primary" :disabled="!isConnected" @click="subscribe">订阅</a-button>
              <a-button :disabled="!isConnected" @click="unsubscribe">取消订阅</a-button>
            </a-space>

            <div class="panel-fill">
              <div class="output-header">
                <span class="output-title">订阅消息</span>
                <a-space>
                  <a-tag color="blue">JSON</a-tag>
                  <a-button size="small" @click="clearMessages">清空消息</a-button>
                </a-space>
              </div>
              <div class="output-box output-box--fill output-box--records">
                <pre class="output-content">{{ messageRecordsText || '收到的 MQTT 消息会格式化为 JSON 输出到这里' }}</pre>
              </div>
            </div>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="12" class="panel-col">
        <a-card title="发布" class="panel-card">
          <div class="panel-stack panel-stack--fill">
            <a-form layout="vertical">
              <a-form-item label="Topic">
                <a-input v-model:value="publishTopic" placeholder="发布 Topic"/>
              </a-form-item>
              <a-form-item label="Payload">
                <a-textarea v-model:value="publishPayload" class="payload-input" placeholder="消息内容"/>
              </a-form-item>
              <a-form-item label="QoS" style="margin-bottom: 0">
                <a-select v-model:value="publishQos" :options="qosOptions" style="width: 100%"/>
              </a-form-item>
            </a-form>

            <a-space wrap>
              <a-checkbox v-model:checked="retain">Retain</a-checkbox>
              <a-button type="primary" :disabled="!isConnected" @click="publish">发布</a-button>
            </a-space>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
}

.panel-grid {
  align-items: stretch;
}

.panel-col {
  display: flex;
}

.panel-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.panel-card :deep(.ant-card-body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.panel-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
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
  align-items: center;
  justify-content: space-between;
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
  .panel-card {
    height: auto;
  }
}
</style>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import type {SelectProps} from 'ant-design-vue'
import type {MqttMessageEvent, MqttQoS} from '../types/mqtt'

defineOptions({name: 'mqtt-demo'})

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

const qosOptions: SelectProps['options'] = [
    {label: 'QoS 0', value: 0},
    {label: 'QoS 1', value: 1},
    {label: 'QoS 2', value: 2},
]

const createClientId = () => `electron_vite_vue_${Math.random().toString(16).slice(2, 10)}`
const createDemoTopic = (id: string) => `electron-vite-vue/demo/${id}`

const clientId = ref(createClientId())
const brokerUrl = ref('mqtt://broker.emqx.io:1883')
const username = ref('')
const password = ref('')
const cleanSession = ref(true)
const reconnectPeriod = ref(1000)

const subscribeTopic = ref(createDemoTopic(clientId.value))
const subscribeQos = ref<MqttQoS>(0)
const publishTopic = ref(createDemoTopic(clientId.value))
const publishQos = ref<MqttQoS>(0)
const publishPayload = ref('Hello from electron-vite-vue')
const retain = ref(false)

const connectionState = ref<ConnectionState>('disconnected')
const log = ref('')
const messages = ref<MqttMessageEvent[]>([])

const isConnected = computed(() => connectionState.value === 'connected')

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

const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
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
        })
        const summary = granted.length
            ? granted.map(item => `${item.topic} (QoS ${item.qos})`).join(', ')
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
    appendLog('默认使用 EMQX Public Broker，可改成你的 mqtt:// 或 ws:// 地址。')

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
        window.mqtt.onError((_, message) => {
            appendLog(`MQTT 错误: ${message}`)
        }),
        window.mqtt.onMessage((_, message) => {
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
    <a-space direction="vertical" size="large" style="width: 100%">
      <a-alert
          message="参考 EMQX Electron MQTT 示例"
          description="当前实现保留了你项目现有的 preload + IPC 安全模型，没有关闭 contextIsolation。"
          show-icon
          type="info"
      />

      <a-card title="Broker 配置">
        <a-space direction="vertical" size="middle" style="width: 100%">
          <a-form layout="vertical">
            <a-form-item label="Broker URL">
              <a-input v-model:value="brokerUrl" placeholder="mqtt://broker.emqx.io:1883"/>
            </a-form-item>

            <a-row :gutter="16">
              <a-col :xs="24" :md="12">
                <a-form-item label="Client ID">
                  <a-input v-model:value="clientId" placeholder="客户端 ID"/>
                </a-form-item>
              </a-col>
              <a-col :xs="24" :md="12">
                <a-form-item label="重连间隔(ms)">
                  <a-input-number
                      v-model:value="reconnectPeriod"
                      :min="0"
                      :step="500"
                      style="width: 100%"
                  />
                </a-form-item>
              </a-col>
            </a-row>

            <a-row :gutter="16">
              <a-col :xs="24" :md="12">
                <a-form-item label="用户名">
                  <a-input v-model:value="username" placeholder="可选"/>
                </a-form-item>
              </a-col>
              <a-col :xs="24" :md="12">
                <a-form-item label="密码">
                  <a-input-password v-model:value="password" placeholder="可选"/>
                </a-form-item>
              </a-col>
            </a-row>
          </a-form>

          <a-space wrap>
            <a-checkbox v-model:checked="cleanSession">Clean Session</a-checkbox>
            <a-button type="primary" @click="connect">连接</a-button>
            <a-button danger @click="disconnect">断开</a-button>
            <a-tag :color="statusColor">{{ statusLabel }}</a-tag>
          </a-space>
        </a-space>
      </a-card>

      <a-row :gutter="16">
        <a-col :xs="24" :lg="12">
          <a-card title="订阅">
            <a-space direction="vertical" size="middle" style="width: 100%">
              <a-form layout="vertical">
                <a-form-item label="Topic">
                  <a-input v-model:value="subscribeTopic" placeholder="订阅 Topic"/>
                </a-form-item>
                <a-form-item label="QoS">
                  <a-select v-model:value="subscribeQos" :options="qosOptions"/>
                </a-form-item>
              </a-form>

              <a-space wrap>
                <a-button type="primary" :disabled="!isConnected" @click="subscribe">订阅</a-button>
                <a-button :disabled="!isConnected" @click="unsubscribe">取消订阅</a-button>
              </a-space>
            </a-space>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="12">
          <a-card title="发布">
            <a-space direction="vertical" size="middle" style="width: 100%">
              <a-form layout="vertical">
                <a-form-item label="Topic">
                  <a-input v-model:value="publishTopic" placeholder="发布 Topic"/>
                </a-form-item>
                <a-form-item label="Payload">
                  <a-textarea
                      v-model:value="publishPayload"
                      :auto-size="{minRows: 3, maxRows: 5}"
                      placeholder="消息内容"
                  />
                </a-form-item>
                <a-form-item label="QoS">
                  <a-select v-model:value="publishQos" :options="qosOptions"/>
                </a-form-item>
              </a-form>

              <a-space wrap>
                <a-checkbox v-model:checked="retain">Retain</a-checkbox>
                <a-button type="primary" :disabled="!isConnected" @click="publish">发布</a-button>
              </a-space>
            </a-space>
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :xs="24" :lg="12">
          <a-card title="消息记录">
            <template #extra>
              <a-button size="small" @click="clearMessages">清空消息</a-button>
            </template>

            <div class="message-list">
              <div v-if="messages.length === 0" class="empty-state">
                暂无消息
              </div>

              <div
                  v-for="message in messages"
                  :key="`${message.timestamp}-${message.topic}-${message.payloadHex}`"
                  class="message-item"
              >
                <div class="message-header">
                  <strong>{{ message.topic }}</strong>
                  <span>{{ new Date(message.timestamp).toLocaleTimeString() }}</span>
                </div>
                <div class="message-payload">
                  {{ message.payloadText || '(empty)' }}
                </div>
                <div class="message-meta">
                  HEX: {{ message.payloadHex || '--' }} | QoS {{ message.qos }} | retain {{ message.retain ? 'Y' : 'N' }}
                </div>
              </div>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="12">
          <a-card title="运行日志">
            <template #extra>
              <a-button size="small" @click="clearLog">清空日志</a-button>
            </template>

            <a-textarea
                v-model:value="log"
                :auto-size="{minRows: 14, maxRows: 20}"
                placeholder="连接、订阅、发布、接收日志"
                readonly
            />
          </a-card>
        </a-col>
      </a-row>
    </a-space>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 320px;
}

.message-item {
  padding: 12px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-surface);
}

.message-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.message-payload {
  margin-bottom: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-meta,
.empty-state {
  color: var(--app-text-secondary);
}
</style>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import type { IpcRendererEvent } from 'electron'
import type {MqttMessageEvent, MqttQoS, MqttSubscriptionGrant} from '../../electron/preload/mod/mqtt'

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
    if (connectionState.value === 'connected') return 'success'
    if (connectionState.value === 'connecting') return 'primary'
    if (connectionState.value === 'reconnecting') return 'warning'
    if (connectionState.value === 'offline') return 'warning'
    return 'danger'
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
  <div class="workspace-page">
    <div class="panel-grid">
      <section class="workspace-section">
        <div class="panel-card__header">
          <div class="panel-title">Broker 配置</div>
        </div>
        <el-divider />
        <el-form label-position="top" class="panel-stack">
          <el-form-item label="Broker URL"><el-input v-model="brokerUrl" placeholder="mqtt://127.0.0.1:1883" /></el-form-item>

          <div class="field-grid field-grid--wide">
            <el-form-item label="Client ID"><el-input v-model="clientId" placeholder="客户端 ID" /></el-form-item>
            <el-form-item label="重连间隔 (ms)"><el-input-number v-model="reconnectPeriod" :min="0" :step="500" controls-position="right" /></el-form-item>
          </div>

          <div class="field-grid">
            <el-form-item label="用户名"><el-input v-model="username" placeholder="可选" /></el-form-item>
            <el-form-item label="密码"><el-input v-model="password" type="password" show-password placeholder="可选" /></el-form-item>
          </div>

          <div class="actions-row">
            <div class="status-row">
              <el-checkbox v-model="cleanSession">Clean Session</el-checkbox>
              <el-tag :type="statusColor" effect="dark">{{ statusLabel }}</el-tag>
            </div>
            <div class="action-buttons">
              <el-button type="primary" @click="connect">连接</el-button>
              <el-button type="danger" @click="disconnect">断开</el-button>
            </div>
          </div>
        </el-form>
      </section>

      <section class="workspace-section">
        <div class="panel-card__header panel-title-row">
          <div class="panel-title">运行日志</div>
          <el-button type="primary" link @click="clearLog">清空日志</el-button>
        </div>
        <el-divider />
        <div class="panel-fill">
          <div class="output-box output-box--fill">
            <pre class="output-content">{{ log || '连接、订阅、发布、接收日志' }}</pre>
          </div>
        </div>
      </section>

      <section class="workspace-section">
        <div class="panel-card__header">
          <div class="panel-title">订阅</div>
        </div>
        <el-divider />
        <el-form label-position="top" class="panel-stack panel-stack--fill">
          <el-form-item label="Topic"><el-input v-model="subscribeTopic" placeholder="订阅 Topic" /></el-form-item>
          <el-form-item label="QoS">
            <el-select v-model="subscribeQos" class="qos-select">
              <el-option v-for="option in qosOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>

          <div class="action-buttons">
            <el-button type="primary" :disabled="!isConnected" @click="subscribe">订阅</el-button>
            <el-button type="primary" plain :disabled="!isConnected" @click="unsubscribe">取消订阅</el-button>
          </div>

          <div class="panel-fill">
            <div class="output-header">
              <span class="output-title">订阅消息</span>
              <div class="action-buttons">
                <el-tag effect="dark">JSON</el-tag>
                <el-button type="primary" link @click="clearMessages">清空消息</el-button>
              </div>
            </div>
            <div class="output-box output-box--fill output-box--records">
              <pre class="output-content">{{ messageRecordsText || '暂无消息' }}</pre>
            </div>
          </div>
        </el-form>
      </section>

      <section class="workspace-section">
        <div class="panel-card__header">
          <div class="panel-title">发布</div>
        </div>
        <el-divider />
        <el-form label-position="top" class="panel-stack panel-stack--fill">
          <el-form-item label="Topic"><el-input v-model="publishTopic" placeholder="发布 Topic" /></el-form-item>
          <el-form-item label="Payload"><el-input
            v-model="publishPayload"
            type="textarea"
            :autosize="{minRows: 3, maxRows: 8}"
            class="payload-input"
            placeholder="消息内容"
          /></el-form-item>
          <el-form-item label="QoS">
            <el-select v-model="publishQos" class="qos-select">
              <el-option v-for="option in qosOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>

          <div class="action-buttons">
            <el-checkbox v-model="retain">Retain</el-checkbox>
            <el-button type="primary" :disabled="!isConnected" @click="publish">发布</el-button>
          </div>
        </el-form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.panel-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 480px) minmax(0, 1fr);
}

.workspace-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-card__header {
  min-height: 32px;
}

.panel-card :deep(.el-divider--horizontal) {
  margin: 8px 0 16px;
}

.panel-stack :deep(.el-form-item) {
  margin-bottom: 0;
}

.qos-select {
  max-width: 200px;
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
  grid-template-columns: minmax(0, 1fr) 144px;
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
  border-radius: 4px;
  background: var(--el-fill-color-blank);
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

@media (max-width: 1100px) {
  .panel-grid {
    grid-template-columns: 1fr;
  }

}

@media (max-width: 480px) {
  .field-grid,
  .field-grid--wide {
    grid-template-columns: 1fr;
  }
}
</style>

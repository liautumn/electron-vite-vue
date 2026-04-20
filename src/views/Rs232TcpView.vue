<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import type { IpcRendererEvent } from 'electron'

type SelectOption<T = string | number | boolean> = {
  label: string
  value: T
  disabled?: boolean
}

type SessionEvent = {
  sessionId: number
}

type DataEvent = SessionEvent & {
  data: string
}

type ErrorEvent = SessionEvent & {
  message: string
}

defineOptions({name: 'rs232-tcp-demo'})

type Mode = 'rs232' | 'tcp'

const SESSION_ID = 0

const modeOptions = [
  {label: 'RS232', value: 'rs232'},
  {label: 'TCP', value: 'tcp'}
]

const mode = ref<Mode>('tcp')
const log = ref('')

const serialConnected = ref(false)
const tcpConnected = ref(false)

const portPath = ref('')
const baudRate = ref(9600)
const comList = ref<SelectOption<string>[]>([
  {value: '', label: '请选择串口'}
])

const host = ref('192.168.1.168')
const tcpPort = ref(8160)

// 规范化 HEX 输入，便于校验与发送。
const normalizeHex = (input: string) => input.replace(/\s+/g, '').toUpperCase()
const isValidHex = (hex: string) =>
  hex.length % 2 === 0 && /^[0-9A-F]+$/.test(hex)
// 统一日志追加，确保格式一致。
const appendLog = (message: string) => {
  log.value += `${message}\n`
}

const sendHex = ref('')

const isRs232 = computed(() => mode.value === 'rs232')
const modeLabel = computed(() => (isRs232.value ? 'RS232' : 'TCP'))

const isConnected = computed(() =>
  isRs232.value ? serialConnected.value : tcpConnected.value
)

// 刷新 RS232 串口列表。
const refreshPorts = async () => {
  comList.value = [{value: '', label: '请选择串口'}]
  try {
    const list = await window.serial.list()
    list.forEach((item: any) => {
      comList.value?.push({
        value: item.path,
        label: item.friendlyName || item.path
      })
    })
    appendLog('串口列表刷新成功')
  } catch (e) {
    appendLog(`获取串口失败: ${e}`)
  }
}

// 按模式连接。
const connectSerial = () => {
  if (!portPath.value) {
    appendLog('请选择串口')
    return
  }
  window.serial.open({
    sessionId: SESSION_ID,
    path: portPath.value,
    baudRate: baudRate.value
  })
}

const connectTcp = () => {
  if (!host.value || !tcpPort.value) {
    appendLog('请填写 TCP 地址与端口')
    return
  }
  window.tcp.connect({
    sessionId: SESSION_ID,
    host: host.value,
    port: tcpPort.value
  })
}

const connect = () => {
  if (isRs232.value) {
    connectSerial()
    return
  }
  connectTcp()
}

const disconnect = () => {
  if (isRs232.value) {
    window.serial.close(SESSION_ID)
    return
  }
  window.tcp.disconnect(SESSION_ID)
}

// 校验 HEX 并按当前模式发送。
const sendData = () => {
  const payload = normalizeHex(sendHex.value)
  if (!payload) return
  if (!isValidHex(payload)) {
    appendLog('发送内容不是有效的 HEX')
    return
  }

  if (!isConnected.value) {
    appendLog(`${modeLabel.value} 未连接`)
    return
  }

  if (isRs232.value) {
    window.serial.write(payload, SESSION_ID)
  } else {
    window.tcp.write(payload, SESSION_ID)
  }
  appendLog(`${modeLabel.value} TX: ${payload}`)
}

// 统一接收日志。
const handleRx = (source: 'RS232' | 'TCP', data: string) => {
  const text = String(data).trim()
  if (!text) return
  appendLog(`${source} RX: ${text}`)
}

const clearLog = () => {
  log.value = ''
}

// 按模式关闭连接。
const closeByMode = (target: Mode) => {
  if (target === 'rs232') {
    window.serial.close(SESSION_ID)
    return
  }
  window.tcp.disconnect(SESSION_ID)
}

// 切换模式时清理旧连接并准备新模式。
watch(mode, (next, prev) => {
  closeByMode(prev)
  if (next === 'rs232') {
    refreshPorts()
  }
})

// 注册 IPC 事件监听。
onMounted(() => {
  if (mode.value === 'rs232') {
    refreshPorts()
  }

  window.serial.onOpen((_event: IpcRendererEvent, payload: SessionEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    serialConnected.value = true
    appendLog('RS232 已连接')
  })

  window.serial.onClose((_event: IpcRendererEvent, payload: SessionEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    serialConnected.value = false
    appendLog('RS232 已断开')
  })

  window.serial.onData((_event: IpcRendererEvent, payload: DataEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    handleRx('RS232', payload.data)
  })

  window.serial.onError((_event: IpcRendererEvent, payload: ErrorEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    appendLog(`RS232 错误: ${payload.message}`)
  })

  window.tcp.onConnect((_event: IpcRendererEvent, payload: SessionEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    tcpConnected.value = true
    appendLog('TCP 已连接')
  })

  window.tcp.onClose((_event: IpcRendererEvent, payload: SessionEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    tcpConnected.value = false
    appendLog('TCP 已断开')
  })

  window.tcp.onData((_event: IpcRendererEvent, payload: DataEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    handleRx('TCP', payload.data)
  })

  window.tcp.onError((_event: IpcRendererEvent, payload: ErrorEvent) => {
    if (payload.sessionId !== SESSION_ID) return

    appendLog(`TCP 错误: ${payload.message}`)
  })
})

onUnmounted(() => {
  closeByMode('rs232')
  closeByMode('tcp')
})
</script>

<template>
  <div class="container">
    <div class="page-stack">
      <q-card flat bordered class="panel-card">
        <q-card-section class="panel-title-row">
          <div class="panel-title">连接方式</div>
          <q-chip square dense :color="isConnected ? 'positive' : 'negative'" text-color="white">
            {{ isConnected ? '已连接' : '未连接' }}
          </q-chip>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <q-btn-toggle
            v-model="mode"
            no-caps
            rounded
            unelevated
            toggle-color="primary"
            :options="modeOptions"
          />

          <div v-if="mode === 'rs232'" class="field-row">
            <q-select
              v-model="portPath"
              outlined
              emit-value
              map-options
              class="field-grow"
              :options="comList"
              label="串口"
              placeholder="选择串口"
            />
            <q-input
              v-model.number="baudRate"
              outlined
              type="number"
              label="波特率"
              min="300"
              step="300"
            />
            <q-btn color="primary" no-caps unelevated @click="connect">连接</q-btn>
            <q-btn color="negative" no-caps unelevated @click="disconnect">断开</q-btn>
            <q-btn outline color="primary" no-caps @click="refreshPorts">刷新串口</q-btn>
          </div>

          <div v-else class="field-row">
            <q-input
              v-model="host"
              outlined
              class="field-grow"
              label="TCP 地址"
              placeholder="TCP 地址"
            />
            <q-input
              v-model.number="tcpPort"
              outlined
              type="number"
              label="端口"
              min="1"
              max="65535"
            />
            <q-btn color="primary" no-caps unelevated @click="connect">连接</q-btn>
            <q-btn color="negative" no-caps unelevated @click="disconnect">断开</q-btn>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">发送与接收</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <q-input
            v-model="sendHex"
            outlined
            label="发送"
            placeholder="发送 HEX"
          />

          <div class="action-buttons">
            <q-btn color="primary" no-caps unelevated @click="sendData">发送</q-btn>
            <q-btn color="negative" no-caps unelevated @click="clearLog">清空日志</q-btn>
          </div>

          <q-input
            v-model="log"
            outlined
            autogrow
            readonly
            type="textarea"
            placeholder="收发日志"
          />
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
}

.page-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-card {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 16px;
}

.panel-title-row,
.action-buttons {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
}

.panel-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-row {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.field-grow {
  flex: 1;
  min-width: 220px;
}

.container :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

@media (max-width: 900px) {
  .field-row,
  .panel-title-row,
  .action-buttons {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

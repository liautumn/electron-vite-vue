<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'

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

const host = ref('')
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
    window.serial.getSessionById(SESSION_ID).close()
    return
  }
  window.tcp.getSessionById(SESSION_ID).disconnect()
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
    window.serial.getSessionById(SESSION_ID).write(payload)
  } else {
    window.tcp.getSessionById(SESSION_ID).write(payload)
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
    window.serial.getSessionById(SESSION_ID).close()
    return
  }
  window.tcp.getSessionById(SESSION_ID).disconnect()
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

  const serialSession = window.serial.getSessionById(SESSION_ID)
  const tcpSession = window.tcp.getSessionById(SESSION_ID)
  const disposers: Array<() => void> = []

  disposers.push(serialSession.onOpen(() => {
    serialConnected.value = true
    appendLog('RS232 已连接')
  }))

  disposers.push(serialSession.onClose(() => {
    serialConnected.value = false
    appendLog('RS232 已断开')
  }))

  disposers.push(serialSession.onData((payload: DataEvent) => {
    handleRx('RS232', payload.data)
  }))

  disposers.push(serialSession.onError((payload: ErrorEvent) => {
    appendLog(`RS232 错误: ${payload.message}`)
  }))

  disposers.push(tcpSession.onConnect(() => {
    tcpConnected.value = true
    appendLog('TCP 已连接')
  }))

  disposers.push(tcpSession.onClose(() => {
    tcpConnected.value = false
    appendLog('TCP 已断开')
  }))

  disposers.push(tcpSession.onData((payload: DataEvent) => {
    handleRx('TCP', payload.data)
  }))

  disposers.push(tcpSession.onError((payload: ErrorEvent) => {
    appendLog(`TCP 错误: ${payload.message}`)
  }))

  onUnmounted(() => {
    disposers.forEach((dispose) => dispose())
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
      <el-card shadow="never" class="panel-card">
        <div class="panel-title-row">
          <div class="panel-title">连接方式</div>
          <el-tag :type="isConnected ? 'success' : 'danger'" effect="dark">
            {{ isConnected ? '已连接' : '未连接' }}
          </el-tag>
        </div>
        <el-divider />
        <div class="panel-stack">
          <el-segmented v-model="mode" :options="modeOptions" />

          <div v-if="mode === 'rs232'" class="field-row">
            <el-select v-model="portPath" class="field-grow" placeholder="选择串口">
              <el-option v-for="option in comList" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
            <el-input-number v-model="baudRate" :min="300" :step="300" controls-position="right" />
            <el-button type="primary" @click="connect">连接</el-button>
            <el-button type="danger" @click="disconnect">断开</el-button>
            <el-button type="primary" plain @click="refreshPorts">刷新串口</el-button>
          </div>

          <div v-else class="field-row">
            <el-input
              v-model="host"
              class="field-grow"
              placeholder="TCP 地址"
            />
            <el-input-number v-model="tcpPort" :min="1" :max="65535" controls-position="right" />
            <el-button type="primary" @click="connect">连接</el-button>
            <el-button type="danger" @click="disconnect">断开</el-button>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <div>
          <div class="panel-title">发送与接收</div>
        </div>
        <el-divider />
        <div class="panel-stack">
          <el-input
            v-model="sendHex"
            placeholder="发送 HEX"
          />

          <div class="action-buttons">
            <el-button type="primary" @click="sendData">发送</el-button>
            <el-button type="danger" @click="clearLog">清空日志</el-button>
          </div>

          <el-input
            v-model="log"
            readonly
            type="textarea"
            :autosize="{minRows: 12, maxRows: 24}"
            placeholder="收发日志"
          />
        </div>
      </el-card>
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
  border-radius: var(--el-border-radius-base);
}

.panel-card :deep(.el-divider--horizontal) {
  margin: 12px 0 16px;
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

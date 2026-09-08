<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {Connection, Delete, Refresh, Position} from '@element-plus/icons-vue'

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
  <div class="workspace-page">
    <div class="page-stack">
      <section class="workspace-section">
        <div class="panel-title-row">
          <div class="panel-title">连接方式</div>
          <el-tag :type="isConnected ? 'success' : 'info'" effect="plain">
            {{ isConnected ? '已连接' : '未连接' }}
          </el-tag>
        </div>
        <el-divider />
        <div class="panel-stack">
          <el-form label-position="top" class="connection-form">
            <el-form-item label="协议">
              <el-segmented v-model="mode" :options="modeOptions" aria-label="连接方式" />
            </el-form-item>
            <el-form-item v-if="isRs232" label="串口" class="endpoint-field">
              <el-select v-model="portPath" placeholder="选择串口">
                <el-option v-for="option in comList" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </el-form-item>
            <el-form-item v-else label="TCP 地址" class="endpoint-field">
              <el-input v-model="host" placeholder="192.168.1.100" @keyup.enter="connect" />
            </el-form-item>
            <el-form-item v-if="isRs232" label="波特率">
              <el-input-number v-model="baudRate" :min="300" :step="300" controls-position="right" />
            </el-form-item>
            <el-form-item v-else label="端口">
              <el-input-number v-model="tcpPort" :min="1" :max="65535" controls-position="right" />
            </el-form-item>
            <div class="action-buttons connection-actions">
              <el-button type="primary" :icon="Connection" :disabled="isConnected" @click="connect">连接</el-button>
              <el-button :disabled="!isConnected" @click="disconnect">断开</el-button>
              <el-tooltip v-if="isRs232" content="刷新串口">
                <el-button :icon="Refresh" aria-label="刷新串口" @click="refreshPorts" />
              </el-tooltip>
            </div>
          </el-form>
        </div>
      </section>

      <section class="workspace-section">
        <div class="panel-title-row">
          <div class="panel-title">发送与接收</div>
          <el-tooltip content="清空日志">
            <el-button text :icon="Delete" aria-label="清空日志" @click="clearLog" />
          </el-tooltip>
        </div>
        <el-divider />
        <div class="panel-stack">
          <div class="send-row">
            <el-input v-model="sendHex" placeholder="发送 HEX" aria-label="发送 HEX" @keyup.enter="sendData" />
            <el-button type="primary" :icon="Position" @click="sendData">发送</el-button>
          </div>

          <el-input
            v-model="log"
            readonly
            type="textarea"
            class="log-textarea"
            :rows="14"
            aria-label="收发日志"
            placeholder="收发日志"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.connection-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.endpoint-field {
  width: 280px;
  max-width: 100%;
}

.connection-actions {
  min-height: 32px;
}

.send-row {
  display: flex;
  gap: 8px;
  max-width: 840px;
}

.send-row > .el-input {
  min-width: 0;
}

@media (max-width: 600px) {
  .endpoint-field {
    width: 100%;
  }
}
</style>

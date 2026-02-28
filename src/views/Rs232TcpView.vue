<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import type {SelectProps} from 'ant-design-vue'

defineOptions({name: 'rs232-tcp-demo'})

type Mode = 'rs232' | 'tcp'

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
const comList = ref<SelectProps['options']>([
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
    window.serial.close()
    return
  }
  window.tcp.disconnect()
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
    window.serial.write(payload)
  } else {
    window.tcp.write(payload)
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
    window.serial.close()
    return
  }
  window.tcp.disconnect()
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

  window.serial.onOpen(() => {
    serialConnected.value = true
    appendLog('RS232 已连接')
  })

  window.serial.onClose(() => {
    serialConnected.value = false
    appendLog('RS232 已断开')
  })

  window.serial.onData((_: any, data: string) => {
    handleRx('RS232', data)
  })

  window.serial.onError((_: any, msg: string) => {
    appendLog(`RS232 错误: ${msg}`)
  })

  window.tcp.onConnect(() => {
    tcpConnected.value = true
    appendLog('TCP 已连接')
  })

  window.tcp.onClose(() => {
    tcpConnected.value = false
    appendLog('TCP 已断开')
  })

  window.tcp.onData((_: any, data: string) => {
    handleRx('TCP', data)
  })

  window.tcp.onError((_: any, msg: string) => {
    appendLog(`TCP 错误: ${msg}`)
  })
})

onUnmounted(() => {
  closeByMode('rs232')
  closeByMode('tcp')
})
</script>

<template>
  <div class="container">
    <a-space direction="vertical" size="large" style="width: 100%">
      <a-card title="连接方式">
        <a-space wrap>
          <a-segmented v-model:value="mode" :options="modeOptions"/>

          <template v-if="mode === 'rs232'">
            <a-select
                v-model:value="portPath"
                style="width: 220px"
                :options="comList"
                placeholder="选择串口"
            />
            <a-input-number
                v-model:value="baudRate"
                :min="300"
                :step="300"
                placeholder="波特率"
            />
            <a-button type="primary" @click="connect">连接</a-button>
            <a-button danger @click="disconnect">断开</a-button>
            <a-button @click="refreshPorts">刷新串口</a-button>
          </template>

          <template v-else>
            <a-input
                v-model:value="host"
                style="width: 200px"
                placeholder="TCP 地址"
            />
            <a-input-number
                v-model:value="tcpPort"
                :min="1"
                :max="65535"
                placeholder="端口"
            />
            <a-button type="primary" @click="connect">连接</a-button>
            <a-button danger @click="disconnect">断开</a-button>
          </template>

          <a-tag :color="isConnected ? 'green' : 'red'">
            {{ isConnected ? '已连接' : '未连接' }}
          </a-tag>
        </a-space>
      </a-card>

      <a-card title="发送与接收">
        <a-space direction="vertical" size="middle" style="width: 100%">
          <a-form layout="vertical">
            <a-form-item label="发送">
              <a-input v-model:value="sendHex" placeholder="发送 HEX"/>
            </a-form-item>
          </a-form>

          <a-space wrap>
            <a-button type="primary" @click="sendData">发送</a-button>
            <a-button danger @click="clearLog">清空日志</a-button>
          </a-space>

          <a-textarea
              v-model:value="log"
              auto-size
              placeholder="收发日志"
          />
        </a-space>
      </a-card>
    </a-space>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
}
</style>

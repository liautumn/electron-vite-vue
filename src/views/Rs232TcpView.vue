<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import type {SelectProps} from 'ant-design-vue'

defineOptions({ name: 'rs232-tcp-demo' })

type Mode = 'rs232' | 'tcp'

const sampleSendHex = '5A0001021000080000000101020006ED08'
const sampleReceiveHex = '5A0001021000010029B5'

const modeOptions = [
  {label: 'RS232', value: 'rs232'},
  {label: 'TCP', value: 'tcp'}
]

const mode = ref<Mode>('rs232')
const log = ref('')
const sendHex = ref(sampleSendHex)

const serialConnected = ref(false)
const tcpConnected = ref(false)

const portPath = ref('')
const baudRate = ref(9600)
const comList = ref<SelectProps['options']>([
  {value: '', label: '请选择串口'}
])

const host = ref('192.168.1.168')
const tcpPort = ref(8160)

const isConnected = computed(() =>
  mode.value === 'rs232' ? serialConnected.value : tcpConnected.value
)

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
    log.value += '串口列表刷新成功\n'
  } catch (e) {
    log.value += `获取串口失败: ${e}\n`
  }
}

const connect = () => {
  if (mode.value === 'rs232') {
    if (!portPath.value) {
      log.value += '请选择串口\n'
      return
    }
    window.serial.open({
      path: portPath.value,
      baudRate: baudRate.value
    })
    return
  }

  if (!host.value || !tcpPort.value) {
    log.value += '请填写 TCP 地址与端口\n'
    return
  }

  window.tcp.connect({
    host: host.value,
    port: tcpPort.value
  })
}

const disconnect = () => {
  if (mode.value === 'rs232') {
    window.serial.close()
    return
  }
  window.tcp.disconnect()
}

const sendData = () => {
  const payload = sendHex.value.trim()
  if (!payload) return

  if (mode.value === 'rs232') {
    if (!serialConnected.value) {
      log.value += 'RS232 未连接\n'
      return
    }
    window.serial.write(payload)
    log.value += `RS232 TX: ${payload.toUpperCase()}\n`
    return
  }

  if (!tcpConnected.value) {
    log.value += 'TCP 未连接\n'
    return
  }
  window.tcp.write(payload)
  log.value += `TCP TX: ${payload.toUpperCase()}\n`
}

const clearLog = () => {
  log.value = ''
}

const fillSample = () => {
  sendHex.value = sampleSendHex
}

watch(mode, (next, prev) => {
  if (prev === 'rs232') {
    window.serial.close()
  }
  if (prev === 'tcp') {
    window.tcp.disconnect()
  }
  if (next === 'rs232') {
    refreshPorts()
  }
})

onMounted(() => {
  refreshPorts()

  window.serial.onOpen(() => {
    serialConnected.value = true
    log.value += 'RS232 已连接\n'
  })

  window.serial.onClose(() => {
    serialConnected.value = false
    log.value += 'RS232 已断开\n'
  })

  window.serial.onData((_: any, data: string) => {
    log.value += `RS232 RX: ${data}\n`
  })

  window.serial.onError((_: any, msg: string) => {
    log.value += `RS232 错误: ${msg}\n`
  })

  window.tcp.onConnect(() => {
    tcpConnected.value = true
    log.value += 'TCP 已连接\n'
  })

  window.tcp.onClose(() => {
    tcpConnected.value = false
    log.value += 'TCP 已断开\n'
  })

  window.tcp.onData((_: any, data: string) => {
    log.value += `TCP RX: ${data}\n`
  })

  window.tcp.onError((_: any, msg: string) => {
    log.value += `TCP 错误: ${msg}\n`
  })
})

onUnmounted(() => {
  window.serial.close()
  window.tcp.disconnect()
})
</script>

<template>
  <div class="container">
    <a-space direction="vertical" size="large" style="width: 100%">
      <a-card title="连接方式">
        <a-space wrap>
          <a-segmented v-model:value="mode" :options="modeOptions" />

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
            <a-form-item label="Send">
              <a-input v-model:value="sendHex" placeholder="发送 HEX" />
            </a-form-item>
            <a-form-item label="Receive 示例">
              <a-input :value="sampleReceiveHex" readonly />
            </a-form-item>
          </a-form>

          <a-space wrap>
            <a-button type="primary" @click="sendData">发送</a-button>
            <a-button @click="fillSample">填充示例</a-button>
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

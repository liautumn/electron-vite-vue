<script setup lang="ts">
import {ref, watch, onMounted, onUnmounted} from 'vue'
import type {SelectProps} from 'ant-design-vue'
import '../components/ProtocolControlWords'

defineOptions({ name: 'serialport-demo' })

/* ========== 基础状态 ========== */
const log = ref('')
const portPath = ref('')
const baudRate = ref(9600)
const autoReconnect = ref(false)
const isConnected = ref(false)
const sendHex = ref('')

let reconnectTimer: NodeJS.Timeout | null = null

/* ========== 串口列表 ========== */
const comList = ref<SelectProps['options']>([
  {value: '', label: '请选择串口'}
])

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

/* ========== 连接 / 断开 ========== */
const connect = () => {
  if (!portPath.value) {
    log.value += '请选择串口\n'
    return
  }

  window.serial.open({
    path: portPath.value,
    baudRate: baudRate.value
  })
}

const close = () => {
  window.serial.close()
}

/* ========== 自动重连 ========== */
const handleReconnect = () => {
  if (!autoReconnect.value) return
  if (reconnectTimer) return

  reconnectTimer = setInterval(() => {
    if (!isConnected.value) {
      log.value += '尝试重连...\n'
      connect()
    } else {
      clearInterval(reconnectTimer!)
      reconnectTimer = null
    }
  }, 2000)
}

watch(autoReconnect, val => {
  if (!val && reconnectTimer) {
    clearInterval(reconnectTimer)
    reconnectTimer = null
  }
})

/* ========== 发送数据 ========== */
const sendData = () => {
  if (!isConnected.value) {
    log.value += '串口未连接\n'
    return
  }

  if (!sendHex.value) return

  window.serial.write(sendHex.value)
  log.value += `TX: ${sendHex.value.toUpperCase()}\n`
}

/* ========== 清空日志 ========== */
const clearLog = () => {
  log.value = ''
}

/* ========== 串口事件监听（来自 Main） ========== */
onMounted(() => {
  refreshPorts()

  window.serial.onOpen(() => {
    isConnected.value = true
    log.value += '串口已连接\n'
  })

  window.serial.onClose(() => {
    isConnected.value = false
    log.value += '串口已断开\n'
    handleReconnect()
  })

  window.serial.onData((_: any, data: string) => {
    log.value += `RX: ${data}\n`
  })

  window.serial.onError((_: any, msg: string) => {
    log.value += `错误: ${msg}\n`
  })
})

onUnmounted(() => {
    close()
})

</script>

<template>
  <div class="container">
    <a-flex gap="middle" wrap="wrap">

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
      <a-button danger @click="close">断开</a-button>
      <a-button @click="refreshPorts" v-permission="'app:demos:serialport:refresh'">
        刷新串口
      </a-button>

      <a-switch v-model:checked="autoReconnect"/>
      <span>自动重连</span>

      <a-input
          v-model:value="sendHex"
          style="width: 320px"
          placeholder="发送 HEX，如：AA 01 FF"
      />

      <a-button type="primary" @click="sendData">发送</a-button>
      <a-button danger @click="clearLog">清空日志</a-button>

      <a-textarea
          v-model:value="log"
          auto-size
          placeholder="串口日志"
      />
    </a-flex>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
}
</style>

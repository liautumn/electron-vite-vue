<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import type {SelectProps} from 'ant-design-vue'
import {crc16Ccitt} from '../utils/protocolFrames'

defineOptions({name: 'rs232-tcp-demo'})

type Mode = 'rs232' | 'tcp'

const modeOptions = [
  {label: 'RS232', value: 'rs232'},
  {label: 'TCP', value: 'tcp'}
]

const mode = ref<Mode>('tcp')
const log = ref('')
const lastParsed = ref('')
const parseError = ref('')
const manualReceiveHex = ref('')
const rxBuffers: Record<'RS232' | 'TCP', string> = {RS232: '', TCP: ''}

const serialConnected = ref(false)
const tcpConnected = ref(false)

const portPath = ref('')
const baudRate = ref(9600)
const comList = ref<SelectProps['options']>([
  {value: '', label: '请选择串口'}
])

const host = ref('192.168.1.168')
const tcpPort = ref(8160)

const normalizeHex = (input: string) =>
    input.replace(/\s+/g, '').toUpperCase()

const sendHex = ref('')

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
  const payload = normalizeHex(sendHex.value.trim())
  if (!payload) return
  if (payload.length % 2 !== 0 || !/^[0-9A-F]+$/.test(payload)) {
    log.value += '发送内容不是有效的 HEX\n'
    return
  }
  const frame = `5A${payload}${crc16Ccitt(payload)}`

  if (mode.value === 'rs232') {
    if (!serialConnected.value) {
      log.value += 'RS232 未连接\n'
      return
    }
    window.serial.write(frame)
    log.value += `RS232 TX: ${frame}\n`
    return
  }

  if (!tcpConnected.value) {
    log.value += 'TCP 未连接\n'
    return
  }
  window.tcp.write(frame)
  log.value += `TCP TX: ${frame}\n`
}

const decodeControlWord = (hex: string) => {
  const value = parseInt(hex, 16)
  const messageId = value & 0xff
  const pad = (val: number, size: number) =>
      val.toString(16).toUpperCase().padStart(size, '0')
  return {
    hex,
    value,
    protocolType: (value >>> 24) & 0xff,
    protocolVersion: (value >>> 16) & 0xff,
    rs485Flag: (value >>> 13) & 0x01,
    uploadFlag: (value >>> 12) & 0x01,
    messageCategory: (value >>> 8) & 0x0f,
    messageId,
    messageIdHex: `0x${pad(messageId, 2)}`
  }
}

const parseFrame = (input: string) => {
  const hex = normalizeHex(input)
  if (!hex) throw new Error('返回内容为空')
  if (hex.length % 2 !== 0) throw new Error('HEX 长度不是偶数')
  const minBytes = 1 + 4 + 2 + 2
  if (hex.length < minBytes * 2) throw new Error('数据长度不足')

  const frameHead = hex.slice(0, 2)
  if (frameHead !== '5A') throw new Error(`帧头错误: ${frameHead}`)

  const controlHex = hex.slice(2, 10)
  const lengthHex = hex.slice(10, 14)
  const payloadLength = parseInt(lengthHex, 16)
  const payloadStart = 14
  const payloadEnd = payloadStart + payloadLength * 2
  const crcEnd = payloadEnd + 4
  if (hex.length < crcEnd) throw new Error('长度字段与实际数据不一致')

  const payloadHex = hex.slice(payloadStart, payloadEnd)
  const crc = hex.slice(payloadEnd, crcEnd)
  const controlWord = decodeControlWord(controlHex)
  const base = {
    frameHead,
    controlWord,
    mid: controlWord.messageIdHex,
    length: {hex: lengthHex, value: payloadLength},
    crc
  } as Record<string, unknown>

  base.payload = {payloadHex}

  return base
}

const updateParsed = (data: string) => {
  const normalized = normalizeHex(data)
  parseError.value = ''
  try {
    const parsed = parseFrame(normalized)
    lastParsed.value = JSON.stringify(parsed, null, 2)
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : '解析失败'
    lastParsed.value = ''
  }
}

const handleRx = (source: 'RS232' | 'TCP', data: string) => {
  const normalized = normalizeHex(data)
  if (!normalized) return
  let buffer = rxBuffers[source] + normalized
  const frames: string[] = []

  while (true) {
    const startIndex = buffer.indexOf('5A')
    if (startIndex === -1) {
      buffer = ''
      break
    }
    if (startIndex > 0) {
      buffer = buffer.slice(startIndex)
    }
    if (buffer.length < 14) break
    const lengthHex = buffer.slice(10, 14)
    const payloadLength = parseInt(lengthHex, 16)
    if (Number.isNaN(payloadLength)) {
      buffer = buffer.slice(2)
      continue
    }
    const frameLength = 18 + payloadLength * 2
    if (buffer.length < frameLength) break
    frames.push(buffer.slice(0, frameLength))
    buffer = buffer.slice(frameLength)
  }

  rxBuffers[source] = buffer
  frames.forEach(frame => {
    log.value += `${source} RX: ${frame}\n`
  })
}

const clearLog = () => {
  log.value = ''
}

const parseManualReceive = () => {
  const input = manualReceiveHex.value.trim()
  if (!input) {
    log.value += '请输入返回数据\n'
    return
  }
  updateParsed(input)
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
    handleRx('RS232', data)
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
    handleRx('TCP', data)
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
            <a-form-item label="Send">
              <a-input v-model:value="sendHex" placeholder="发送 HEX（不含 5A 与 CRC）"/>
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

      <a-card title="返回解析">
        <a-space direction="vertical" size="middle" style="width: 100%">
          <a-alert
              message="帧头固定 5A；MID=0x10 为配置响应，MID=0x00 为标签数据上传。"
              type="info"
              show-icon
          />

          <a-space direction="vertical" size="middle" style="width: 100%">
            <a-textarea
                v-model:value="manualReceiveHex"
                auto-size
                placeholder="输入返回帧（包含 5A 与 CRC）"
            />
            <a-button type="primary" @click="parseManualReceive">解析</a-button>
          </a-space>

          <a-form layout="vertical">
            <a-form-item label="JSON 解析结果">
              <a-textarea
                  v-model:value="lastParsed"
                  auto-size
                  readonly
                  placeholder="解析结果"
              />
            </a-form-item>
          </a-form>

          <a-alert v-if="parseError" :message="parseError" type="error" show-icon/>
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

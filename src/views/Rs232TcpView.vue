<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import type {SelectProps} from 'ant-design-vue'

defineOptions({ name: 'rs232-tcp-demo' })

type Mode = 'rs232' | 'tcp'

const sampleSendHex = '5A0001021000080000000101020006ED08'
const sampleReceiveHex = '5A0001021000010029B5'
const sampleReceiveMid00 =
  '5A00011200002B000CE2801160600002094ED74AA6300001014B020003000CE2801160200062A6DAE9092908000E1A5A09645EFC'

const modeOptions = [
  {label: 'RS232', value: 'rs232'},
  {label: 'TCP', value: 'tcp'}
]

const mode = ref<Mode>('rs232')
const log = ref('')
const sendHex = ref(sampleSendHex)
const lastRaw = ref('')
const lastParsed = ref('')
const parseError = ref('')

const serialConnected = ref(false)
const tcpConnected = ref(false)

const portPath = ref('')
const baudRate = ref(9600)
const comList = ref<SelectProps['options']>([
  {value: '', label: '请选择串口'}
])

const host = ref('192.168.1.168')
const tcpPort = ref(8160)

const tagReadResultMap: Record<number, string> = {
  0: '读取成功',
  2: 'CRC 错误',
  3: '数据区被锁定',
  4: '数据区溢出',
  5: '访问密码错误',
  6: '其他标签错误',
  7: '其他读写器错误'
}

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

const normalizeHex = (input: string) =>
  input.replace(/\s+/g, '').toUpperCase()

const padHex = (value: number, length: number) =>
  value.toString(16).toUpperCase().padStart(length, '0')

const decodeControlWord = (hex: string) => {
  const value = parseInt(hex, 16)
  const messageId = value & 0xff
  return {
    hex,
    value,
    protocolType: (value >>> 24) & 0xff,
    protocolVersion: (value >>> 16) & 0xff,
    rs485Flag: (value >>> 13) & 0x01,
    uploadFlag: (value >>> 12) & 0x01,
    messageCategory: (value >>> 8) & 0x0f,
    messageId,
    messageIdHex: `0x${padHex(messageId, 2)}`
  }
}

const parseMid10Payload = (payloadHex: string) => {
  if (payloadHex.length < 2) return {payloadHex}
  const code = parseInt(payloadHex.slice(0, 2), 16)
  return {
    result: {
      code,
      message: code === 0 ? '配置成功' : '未知结果'
    },
    payloadHex
  }
}

const parseMid00Payload = (payloadHex: string) => {
  let cursor = 0
  const readBytes = (len: number) => {
    const start = cursor * 2
    const end = start + len * 2
    if (end > payloadHex.length) {
      throw new Error('payload 长度不足')
    }
    const chunk = payloadHex.slice(start, end)
    cursor += len
    return chunk
  }
  const readU8 = () => parseInt(readBytes(1), 16)
  const readU16 = () => parseInt(readBytes(2), 16)
  const readU32 = () => parseInt(readBytes(4), 16)
  const readS16 = () => {
    const val = readU16()
    return val & 0x8000 ? val - 0x10000 : val
  }

  const epcLength = readU16()
  const epc = readBytes(epcLength)
  const pc = readBytes(2)
  const antennaId = readU8()
  const items: Array<Record<string, unknown>> = []

  while (cursor < payloadHex.length / 2) {
    const pid = readU8()
    const pidHex = `0x${padHex(pid, 2)}`
    switch (pid) {
      case 0x01: {
        const rssi = readU8()
        items.push({pid: pidHex, name: 'RSSI', value: rssi})
        break
      }
      case 0x02: {
        const code = readU8()
        items.push({
          pid: pidHex,
          name: '标签数据读取结果',
          value: {code, message: tagReadResultMap[code] ?? '未知结果'}
        })
        break
      }
      case 0x03: {
        const len = readU16()
        const tid = readBytes(len)
        items.push({pid: pidHex, name: '标签 TID 数据', length: len, value: tid})
        break
      }
      case 0x04: {
        const len = readU16()
        const data = readBytes(len)
        items.push({pid: pidHex, name: '标签用户数据区', length: len, value: data})
        break
      }
      case 0x05: {
        const len = readU16()
        const data = readBytes(len)
        items.push({pid: pidHex, name: '标签保留区数据', length: len, value: data})
        break
      }
      case 0x06: {
        const value = readU8()
        items.push({pid: pidHex, name: '子天线号', value})
        break
      }
      case 0x07: {
        const seconds = readU32()
        const micros = readU32()
        items.push({pid: pidHex, name: '标签读取 UTC 时间', seconds, micros})
        break
      }
      case 0x08: {
        const frequencyKhz = readU32()
        items.push({
          pid: pidHex,
          name: '当前频点',
          kHz: frequencyKhz,
          MHz: Number((frequencyKhz / 1000).toFixed(3))
        })
        break
      }
      case 0x09: {
        const phase = readU8()
        items.push({
          pid: pidHex,
          name: '当前标签相位',
          value: phase,
          radians: Number(((phase / 128) * 2 * Math.PI).toFixed(4))
        })
        break
      }
      case 0x0a: {
        const len = readU16()
        const data = readBytes(len)
        items.push({pid: pidHex, name: 'EPC 区数据', length: len, value: data})
        break
      }
      case 0x11: {
        const value = readU16()
        items.push({pid: pidHex, name: 'LTU27 温度传感数据', value})
        break
      }
      case 0x12: {
        const value = readS16()
        items.push({
          pid: pidHex,
          name: 'LTU31 标签温度',
          value,
          celsius: Number((value / 100).toFixed(2))
        })
        break
      }
      case 0x13: {
        const value = readU16()
        items.push({pid: pidHex, name: '坤锐温度传感数据', value})
        break
      }
      case 0x14: {
        const value = readS16()
        items.push({pid: pidHex, name: 'RSSI - dBm', value})
        break
      }
      case 0x15: {
        const value = readU16()
        items.push({pid: pidHex, name: '标签 EPC CRC', value: padHex(value, 4)})
        break
      }
      case 0x20: {
        const len = readU8()
        const data = readBytes(len)
        items.push({pid: pidHex, name: '保留(UDP)', length: len, value: data})
        break
      }
      case 0x21: {
        const value = readU32()
        items.push({pid: pidHex, name: '保留(UDP)', value})
        break
      }
      case 0x22: {
        const value = readU32()
        items.push({pid: pidHex, name: '标签应答包序号', value})
        break
      }
      default: {
        const remaining = payloadHex.length / 2 - cursor
        const rest = remaining > 0 ? readBytes(remaining) : ''
        items.push({pid: pidHex, name: '未识别 PID', value: rest})
        break
      }
    }
  }

  return {
    epcLength: {hex: padHex(epcLength, 4), value: epcLength},
    epc,
    pc,
    antennaId,
    items
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

  if (controlWord.messageId === 0x10) {
    base.payload = parseMid10Payload(payloadHex)
  } else if (controlWord.messageId === 0x00) {
    base.payload = parseMid00Payload(payloadHex)
  } else {
    base.payload = {payloadHex}
  }

  return base
}

const updateParsed = (data: string) => {
  const normalized = normalizeHex(data)
  lastRaw.value = normalized
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
  log.value += `${source} RX: ${normalized}\n`
  updateParsed(normalized)
}

const clearLog = () => {
  log.value = ''
}

const fillSample = () => {
  sendHex.value = sampleSendHex
}

const applySample = (type: 'mid10' | 'mid00') => {
  const sample = type === 'mid10' ? sampleReceiveHex : sampleReceiveMid00
  updateParsed(sample)
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
            <a-form-item label="MID=0x10 响应示例">
              <a-input :value="sampleReceiveHex" readonly />
            </a-form-item>
            <a-form-item label="MID=0x00 响应示例">
              <a-textarea :value="sampleReceiveMid00" auto-size readonly />
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

      <a-card title="返回解析">
        <a-space direction="vertical" size="middle" style="width: 100%">
          <a-alert
              message="帧头固定 5A；MID=0x10 为配置响应，MID=0x00 为标签数据上传。"
              type="info"
              show-icon
          />

          <a-space wrap>
            <a-button @click="applySample('mid10')">加载 MID=0x10 示例</a-button>
            <a-button @click="applySample('mid00')">加载 MID=0x00 示例</a-button>
          </a-space>

          <a-form layout="vertical">
            <a-form-item label="最近返回原值">
              <a-textarea
                  v-model:value="lastRaw"
                  auto-size
                  placeholder="等待设备返回..."
              />
            </a-form-item>
            <a-form-item label="JSON 解析结果">
              <a-textarea
                  v-model:value="lastParsed"
                  auto-size
                  readonly
                  placeholder="解析结果"
              />
            </a-form-item>
          </a-form>

          <a-alert v-if="parseError" :message="parseError" type="error" show-icon />
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

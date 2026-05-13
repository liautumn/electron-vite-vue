<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Notify } from 'quasar'
import { ledSingleDevice } from '../components/led/LedDevice'
import {
  buildShowAllLedsCommand,
  buildShowSingleLedCommand,
  DEFAULT_LED_MODULE_ID,
  type LedColorCode,
  type LedDisplayMode
} from '../components/led/LedProtocol'
import {
  showAllLeds,
  showSingleLed,
  turnOffAllLeds,
  turnOffSingleLed
} from '../components/led/LedHelper'
import { useDeviceConnectionsStore, type DeviceConnectionProfile } from '../stores/deviceConnections'

defineOptions({ name: 'led-demo' })

type SelectOption<T = string | number | boolean> = {
  label: string
  value: T
  disabled?: boolean
}

const modeOptions: SelectOption<LedDisplayMode>[] = [
  { label: '常亮 (0x00)', value: 0x00 },
  { label: '慢闪 (0x01)', value: 0x01 },
  { label: '快闪 (0x02)', value: 0x02 }
]

const colorOptions: SelectOption<LedColorCode>[] = [
  { label: '关闭 (0x00)', value: 0x00 },
  { label: '红 (0x01)', value: 0x01 },
  { label: '绿 (0x02)', value: 0x02 },
  { label: '蓝 (0x03)', value: 0x03 },
  { label: '黄 (0x04)', value: 0x04 },
  { label: '青 (0x05)', value: 0x05 },
  { label: '紫 (0x06)', value: 0x06 },
  { label: '白 (0x07)', value: 0x07 },
  { label: '自定义颜色 1 (0x08)', value: 0x08 },
  { label: '自定义颜色 2 (0x09)', value: 0x09 },
  { label: '自定义颜色 3 (0x0A)', value: 0x0A },
  { label: '自定义颜色 4 (0x0B)', value: 0x0B },
  { label: '自定义颜色 5 (0x0C)', value: 0x0C },
  { label: '自定义颜色 6 (0x0D)', value: 0x0D },
  { label: '自定义颜色 7 (0x0E)', value: 0x0E },
  { label: '自定义颜色 8 (0x0F)', value: 0x0F }
]

const deviceConnectionsStore = useDeviceConnectionsStore()
const { activeLedSessionId, connectionProfiles } = storeToRefs(deviceConnectionsStore)
const snapshot = ledSingleDevice.getSnapshot()

const sessionId = ref<number | null>(snapshot.sessionId)
const moduleId = ref<number | null>(DEFAULT_LED_MODULE_ID)
const connected = ref(snapshot.connected)
const lastError = ref(snapshot.lastError ?? '')

const singleAddress = ref<number | null>(1)
const singleMode = ref<LedDisplayMode>(0x00)
const singleColor = ref<LedColorCode>(0x01)

const allMode = ref<LedDisplayMode>(0x00)
const allColor = ref<LedColorCode>(0x01)

const rawHex = ref('')
const log = ref('')

const connectionSessionOptions = computed(() =>
  getSerialConnectionProfiles().map((profile) => ({
    label: formatConnectionSessionLabel(profile),
    value: profile.sessionId
  }))
)
const selectedConnectionProfile = computed(() =>
  getSerialConnectionProfiles().find((profile) => profile.sessionId === sessionId.value) ?? null
)
const connectionSessionHint = computed(() => {
  const profile = selectedConnectionProfile.value
  if (!profile) {
    return '当前未配置串口会话，请先在项目设置里新增串口连接。'
  }

  return `当前串口会话：${profile.portPath || '未选择串口'} / ${profile.baudRate || 9600}`
})

let disposeStatusListener = () => {}
let disposeDataListener = () => {}

const notify = (type: 'positive' | 'negative', content: unknown) => {
  Notify.create({
    type,
    message: String(content ?? ''),
    position: 'top',
    timeout: 2200
  })
}

function normalizeHex(input: string) {
  return String(input ?? '').replace(/\s+/g, '').toUpperCase()
}

function formatHex(input: string) {
  const normalized = normalizeHex(input)
  if (!normalized) {
    return ''
  }
  return normalized.replace(/.{2}/g, '$& ').trim()
}

function appendLog(messageText: string) {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  log.value += `[${stamp}] ${messageText}\n`
}

function resolveError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatConnectionSessionLabel(profile: Extract<DeviceConnectionProfile, { mode: 'serial' }>) {
  return `${profile.name} / Session ${profile.sessionId} / ${profile.portPath || '未选择串口'} / ${profile.baudRate || 9600}`
}

function getSerialConnectionProfiles() {
  return connectionProfiles.value
    .filter((profile): profile is Extract<DeviceConnectionProfile, { mode: 'serial' }> => profile.mode === 'serial')
    .sort((left, right) => left.sessionId - right.sessionId)
}

function resolveSerialSessionId(preferredSessionId?: unknown) {
  const profiles = getSerialConnectionProfiles()
  const normalizedPreferredSessionId = parseSessionId(preferredSessionId)

  return profiles.find((profile) => profile.sessionId === normalizedPreferredSessionId)?.sessionId
    ?? profiles[0]?.sessionId
    ?? null
}

function handleSessionChange(nextSessionId: number | null) {
  sessionId.value = resolveSerialSessionId(nextSessionId)
}

function parseSessionId(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

function requireInteger(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {}
) {
  const parsed = Number(value)
  const { min = 0, max } = options

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label}必须是整数`)
  }
  if (parsed < min) {
    throw new Error(`${label}必须大于等于 ${min}`)
  }
  if (typeof max === 'number' && parsed > max) {
    throw new Error(`${label}必须小于等于 ${max}`)
  }

  return parsed
}

function requireSessionId(value: unknown) {
  return requireInteger(value, '会话 ID', { min: 0 })
}

function requireByte(value: unknown, label: string) {
  return requireInteger(value, label, { min: 0, max: 0xFF })
}

function requireLedAddress(value: unknown) {
  return requireInteger(value, '灯地址', { min: 1, max: 0xFF })
}

function requireHexPayload(input: string, label = '命令 HEX') {
  const value = normalizeHex(input)
  if (!value) {
    throw new Error(`${label}不能为空`)
  }
  if (!/^[0-9A-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label}必须是偶数位 HEX`)
  }
  return value
}

function syncSnapshot(targetSessionId: number | null) {
  if (targetSessionId === null) {
    connected.value = false
    lastError.value = ''
    return
  }

  const currentSnapshot = ledSingleDevice.getSnapshot(targetSessionId)
  connected.value = currentSnapshot.connected
  lastError.value = currentSnapshot.lastError ?? ''
}

function wireSession(targetSessionId: number | null) {
  disposeStatusListener()
  disposeDataListener()

  if (targetSessionId === null) {
    return
  }

  const tcpSession = window.tcp.getSessionById(targetSessionId)
  const serialSession = window.serial.getSessionById(targetSessionId)

  const updateStatus = () => {
    const currentSnapshot = ledSingleDevice.getSnapshot(targetSessionId)
    connected.value = currentSnapshot.connected
    lastError.value = currentSnapshot.lastError ?? ''
  }

  const statusDisposers = [
    tcpSession.onConnect(updateStatus),
    tcpSession.onClose(updateStatus),
    tcpSession.onError(updateStatus),
    serialSession.onOpen(updateStatus),
    serialSession.onClose(updateStatus),
    serialSession.onError(updateStatus)
  ]

  disposeStatusListener = () => {
    statusDisposers.forEach((dispose) => dispose())
  }

  const dataDisposers = [
    tcpSession.onData((payload: { data: string }) => {
      appendLog(`会话[${targetSessionId}] RX ${formatHex(payload.data)}`)
    }),
    serialSession.onData((payload: { data: string }) => {
      appendLog(`会话[${targetSessionId}] RX ${formatHex(payload.data)}`)
    })
  ]

  disposeDataListener = () => {
    dataDisposers.forEach((dispose) => dispose())
  }

  updateStatus()
}

const singleCommandPreview = computed(() => {
  try {
    const commandHex = buildShowSingleLedCommand(
      requireLedAddress(singleAddress.value),
      singleMode.value,
      singleColor.value,
      requireByte(moduleId.value, '模块地址')
    )
    return formatHex(commandHex)
  } catch (error) {
    return `参数有误：${resolveError(error)}`
  }
})

const allCommandPreview = computed(() => {
  try {
    const commandHex = buildShowAllLedsCommand(
      allMode.value,
      allColor.value,
      requireByte(moduleId.value, '模块地址')
    )
    return formatHex(commandHex)
  } catch (error) {
    return `参数有误：${resolveError(error)}`
  }
})

async function handleShowSingleLed() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const targetModuleId = requireByte(moduleId.value, '模块地址')
    const targetAddress = requireLedAddress(singleAddress.value)

    const commandHex = await showSingleLed(
      targetAddress,
      singleMode.value,
      singleColor.value,
      targetModuleId,
      targetSessionId
    )
    appendLog(`会话[${targetSessionId}] TX ${formatHex(commandHex)}`)
    notify('positive', '单灯控制命令已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

async function handleTurnOffSingleLed() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const targetModuleId = requireByte(moduleId.value, '模块地址')
    const targetAddress = requireLedAddress(singleAddress.value)

    const commandHex = await turnOffSingleLed(
      targetAddress,
      targetModuleId,
      targetSessionId
    )
    appendLog(`会话[${targetSessionId}] TX ${formatHex(commandHex)}`)
    notify('positive', '关闭单灯命令已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

async function handleShowAllLeds() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const targetModuleId = requireByte(moduleId.value, '模块地址')

    const commandHex = await showAllLeds(
      allMode.value,
      allColor.value,
      targetModuleId,
      targetSessionId
    )
    appendLog(`会话[${targetSessionId}] TX ${formatHex(commandHex)}`)
    notify('positive', '全灯控制命令已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

async function handleTurnOffAllLeds() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const targetModuleId = requireByte(moduleId.value, '模块地址')

    const commandHex = await turnOffAllLeds(
      targetModuleId,
      targetSessionId
    )
    appendLog(`会话[${targetSessionId}] TX ${formatHex(commandHex)}`)
    notify('positive', '关闭全灯命令已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

async function handleSendRawHex() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const payload = requireHexPayload(rawHex.value)

    await ledSingleDevice.sendHex(payload, targetSessionId)
    appendLog(`会话[${targetSessionId}] TX ${formatHex(payload)}`)
    notify('positive', '自定义 HEX 已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

function clearLog() {
  log.value = ''
}

watch(
  [sessionId, connectionProfiles],
  ([nextSessionId]) => {
    const resolvedSessionId = resolveSerialSessionId(nextSessionId)
    if (resolvedSessionId !== nextSessionId) {
      sessionId.value = resolvedSessionId
      return
    }

    if (resolvedSessionId === null) {
      syncSnapshot(null)
      wireSession(null)
      return
    }

    if (activeLedSessionId.value !== resolvedSessionId) {
      deviceConnectionsStore.setActiveLedSession(resolvedSessionId)
    }
    ledSingleDevice.setActiveSession(resolvedSessionId)
    syncSnapshot(resolvedSessionId)
    wireSession(resolvedSessionId)
  },
  { deep: true, immediate: true }
)

watch(
  activeLedSessionId,
  (nextSessionId) => {
    const resolvedSessionId = resolveSerialSessionId(nextSessionId)
    if (sessionId.value !== resolvedSessionId) {
      sessionId.value = resolvedSessionId
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  disposeStatusListener()
  disposeDataListener()
})
</script>

<template>
  <div class="container">
    <div class="page-stack">
      <q-card flat bordered class="panel-card">
        <q-card-section class="panel-title-row">
          <div class="panel-title">会话与模块参数</div>
          <q-chip square dense :color="connected ? 'positive' : 'negative'" text-color="white">
            {{ connected ? '已连接' : '未连接' }}
          </q-chip>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <div class="form-grid">
            <q-select
              :model-value="selectedConnectionProfile?.sessionId ?? null"
              outlined
              emit-value
              map-options
              :options="connectionSessionOptions"
              label="连接会话 ID"
              placeholder="选择串口 sessionId"
              @update:model-value="handleSessionChange"
            />
            <q-input
              v-model.number="moduleId"
              outlined
              type="number"
              min="0"
              max="255"
              step="1"
              label="模块地址 (0-255)"
            />
          </div>
          <div class="muted-text">{{ connectionSessionHint }}</div>
          <div class="muted-text">LED 页面仅支持串口会话，连接参数请在“设备连接管理”里维护。</div>
          <div v-if="lastError" class="error-text">
            最近错误：{{ lastError }}
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">单灯控制（06 指令）</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <div class="form-grid">
            <q-input
              v-model.number="singleAddress"
              outlined
              type="number"
              min="1"
              max="255"
              step="1"
              label="灯地址 (1-255)"
            />
            <q-select
              v-model="singleMode"
              outlined
              emit-value
              map-options
              label="显示模式"
              :options="modeOptions"
            />
            <q-select
              v-model="singleColor"
              outlined
              emit-value
              map-options
              label="颜色"
              :options="colorOptions"
            />
          </div>
          <div class="action-buttons">
            <q-btn color="primary" no-caps unelevated @click="handleShowSingleLed">发送单灯命令</q-btn>
            <q-btn outline color="primary" no-caps @click="handleTurnOffSingleLed">关闭单灯</q-btn>
          </div>
          <div class="muted-text">
            预览：{{ singleCommandPreview }}
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">全灯统一控制（05 指令）</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <div class="form-grid">
            <q-select
              v-model="allMode"
              outlined
              emit-value
              map-options
              label="显示模式"
              :options="modeOptions"
            />
            <q-select
              v-model="allColor"
              outlined
              emit-value
              map-options
              label="颜色"
              :options="colorOptions"
            />
          </div>
          <div class="action-buttons">
            <q-btn color="primary" no-caps unelevated @click="handleShowAllLeds">发送全灯命令</q-btn>
            <q-btn outline color="primary" no-caps @click="handleTurnOffAllLeds">关闭全灯</q-btn>
          </div>
          <div class="muted-text">
            预览：{{ allCommandPreview }}
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">自定义 HEX</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <div class="muted-text">
            可直接发送原始 Modbus HEX，例如：`01 06 00 01 00 01 19 CA`
          </div>
          <div class="serial-port-row">
            <q-input
              v-model="rawHex"
              outlined
              class="field-grow"
              label="命令 HEX"
              placeholder="输入偶数位 HEX，支持空格"
            />
            <q-btn color="primary" no-caps unelevated @click="handleSendRawHex">发送自定义 HEX</q-btn>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section class="panel-title-row">
          <div class="panel-title">通讯日志</div>
          <q-btn color="negative" no-caps unelevated @click="clearLog">清空日志</q-btn>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <q-input
            :model-value="log"
            outlined
            readonly
            type="textarea"
            rows="14"
            class="log-textarea"
            placeholder="收发日志会显示在这里"
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

.form-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.serial-port-row {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
}

.field-grow {
  flex: 1;
  min-width: 280px;
}

.muted-text {
  color: var(--app-text-secondary);
}

.error-text {
  color: rgb(220, 38, 38);
}

.log-textarea :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

@media (max-width: 1080px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .panel-title-row,
  .action-buttons,
  .serial-port-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

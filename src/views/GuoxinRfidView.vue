<script setup lang="ts">
import {storeToRefs} from 'pinia'
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {Notify} from 'quasar'
import {guoxinDevice, type GuoxinConnectionMode} from '../components/rfid/guoxin/GuoXinDevice'
import type {IRFIDTagReadMessage} from '../components/rfid/guoxin/GuoXinCommon'
import {normalizeHex} from '../components/rfid/guoxin/GuoXinCommon'
import {
  configEPCBasebandParam,
  configPower,
  readAllAntOutputPower,
  readEPC,
  readEPCContinuous,
  stopReadEPC,
  writeEPC,
  writeEPCFirstTime
} from '../components/rfid/guoxin/GuoXinRfidHelper'
import {useGuoxinRfidStore, type GuoxinRfidConfig} from '../stores/guoxinRfid'
import {useDeviceConnectionsStore, type DeviceConnectionProfile} from '../stores/deviceConnections'

defineOptions({name: 'guoxin-rfid-demo'})

const snapshot = guoxinDevice.getSnapshot()

const rfidStore = useGuoxinRfidStore()
const {config: rfidConfig} = storeToRefs(rfidStore)
const deviceConnectionsStore = useDeviceConnectionsStore()
const {activeRfidSessionId, connectionProfiles} = storeToRefs(deviceConnectionsStore)

if (snapshot.connected) {
  rfidStore.setConfig({
    mode: snapshot.mode,
    connectionSessionId: snapshot.sessionId,
    antennaCount: snapshot.antNum
  })
}

const connected = ref(snapshot.connected)
const lastError = ref(snapshot.lastError ?? '')
const currentMode = ref(snapshot.mode)
const inventoryStatus = ref('空闲')
const latestTag = ref<IRFIDTagReadMessage | null>(null)
const log = ref('')
const powerModalVisible = ref(false)
const powerSubmitting = ref(false)
const powerEditor = ref<number[]>([])
const DEFAULT_WRITE_EPC_DEMO = '192012345678901234567895'
const CONNECTION_MODE_OPTIONS: Array<{label: string, value: GuoxinConnectionMode}> = [
  {label: 'TCP', value: 'tcp'},
  {label: 'Serial', value: 'serial'}
]

let stopContinuousRead: null | (() => void) = null
let disposeStatusListener = () => {
}
let disposeRawListener = () => {
}

const notify = (type: 'positive' | 'negative', content: unknown) => {
  Notify.create({
    type,
    message: String(content ?? ''),
    position: 'top-right',
    timeout: 2200
  })
}

const antennaCountModel = computed({
  get: () => rfidConfig.value.antennaCount,
  set: (value) => {
    if (typeof value !== 'number') {
      return
    }
    rfidStore.setConfig({antennaCount: value})
  }
})
const inventoryAntennaOptions = computed(() =>
  Array.from({length: rfidConfig.value.antennaCount}, (_, index) => ({
    label: `天线${index + 1}`,
    value: index + 1
  }))
)
const inventoryAntennasModel = computed<number[]>({
  get: () => normalizeAntennaSelection(rfidConfig.value.antsInput, rfidConfig.value.antennaCount),
  set: (value) => {
    const antennas = normalizeAntennaSelection(value, rfidConfig.value.antennaCount)
    rfidStore.setConfig({antsInput: antennas.join(',')})
  }
})
const writeAntennaModel = computed<number>({
  get: () =>
    Math.min(
      Math.max(rfidConfig.value.writeAntenna, 1),
      rfidConfig.value.antennaCount
    ),
  set: (value) => {
    if (typeof value !== 'number') {
      return
    }
    rfidStore.setConfig({writeAntenna: value})
  }
})
const connectionSessionOptions = computed(() =>
  getConnectionProfilesByMode(rfidConfig.value.mode).map((profile) => ({
    label: formatConnectionSessionLabel(profile),
    value: profile.sessionId
  }))
)
const selectedConnectionProfile = computed(() =>
  getConnectionProfilesByMode(rfidConfig.value.mode)
    .find((profile) => profile.sessionId === rfidConfig.value.connectionSessionId) ?? null
)
const connectionSessionHint = computed(() => {
  const profile = selectedConnectionProfile.value
  if (!profile) {
    return rfidConfig.value.mode === 'serial'
      ? '当前未配置 Serial 会话，请先在项目设置里新增串口连接。'
      : '当前未配置 TCP 会话，请先在项目设置里新增 TCP 连接。'
  }

  return profile.mode === 'serial'
    ? `当前 Serial 会话：${profile.portPath || '未选择串口'} / ${profile.baudRate || 9600}`
    : `当前 TCP 会话：${profile.host || '-'}:${profile.port || '-'}`
})

function appendLog(messageText: string) {
  const stamp = new Date().toLocaleTimeString('zh-CN', {hour12: false})
  log.value += `[${stamp}] ${messageText}\n`
}

function normalizeSessionId(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

function randomHex(length: number) {
  const safeLength = Math.max(2, length)
  const bytes = new Uint8Array(Math.ceil(safeLength / 2))

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256)
    })
  }

  return Array.from(bytes, (item) => item.toString(16).padStart(2, '0').toUpperCase())
    .join('')
    .slice(0, safeLength)
}

function formatPowerLevels(powerLevels: number[]) {
  return powerLevels.map((power, index) => `天线${index + 1}=${power}`).join(', ')
}

function formatConnectionModeLabel(mode: GuoxinConnectionMode) {
  return mode === 'serial' ? 'Serial' : 'TCP'
}

function formatConnectionSessionLabel(profile: DeviceConnectionProfile) {
  const endpoint =
    profile.mode === 'serial'
      ? `${profile.portPath || '未选择串口'} / ${profile.baudRate || 9600}`
      : `${profile.host || '-'}:${profile.port || '-'}`

  return `${profile.name} / Session ${profile.sessionId} / ${endpoint}`
}

function getConnectionProfilesByMode(mode: GuoxinConnectionMode) {
  return connectionProfiles.value
    .filter((profile) => profile.mode === mode)
    .sort((left, right) => left.sessionId - right.sessionId)
}

function resolveSessionIdForMode(mode: GuoxinConnectionMode, preferredSessionId?: unknown) {
  const profiles = getConnectionProfilesByMode(mode)
  const normalizedPreferredSessionId = normalizeSessionId(preferredSessionId)

  return profiles.find((profile) => profile.sessionId === normalizedPreferredSessionId)?.sessionId
    ?? profiles[0]?.sessionId
    ?? 0
}

function syncConnectionSnapshot(mode: GuoxinConnectionMode, sessionId: number) {
  guoxinDevice.setActiveSession(sessionId)
  guoxinDevice.setMode(mode, sessionId)
  const snapshot = guoxinDevice.getSnapshot(sessionId)
  connected.value = snapshot.connected
  currentMode.value = snapshot.mode
  lastError.value = snapshot.lastError ?? ''
}

function handleConnectionModeChange(mode: GuoxinConnectionMode) {
  rfidStore.setConfig({
    mode,
    connectionSessionId: resolveSessionIdForMode(mode, rfidConfig.value.connectionSessionId)
  })
}

function handleConnectionSessionChange(sessionId: number | null) {
  if (typeof sessionId !== 'number') {
    return
  }

  rfidStore.setConfig({
    mode: rfidConfig.value.mode,
    connectionSessionId: resolveSessionIdForMode(rfidConfig.value.mode, sessionId)
  })
}

function openPowerConfigModal() {
  powerEditor.value = [...rfidConfig.value.powerLevels]
  powerModalVisible.value = true
}

function resolveError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function requireHexValue(input: string, label: string, exactLength?: number) {
  const value = normalizeHex(input)
  if (!value) {
    throw new Error(`${label}不能为空`)
  }
  if (!/^[0-9A-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${label}必须是偶数位 HEX`)
  }
  if (typeof exactLength === 'number' && value.length !== exactLength) {
    throw new Error(`${label}必须是 ${exactLength} 位 HEX`)
  }
  return value
}

function requireSessionId(value: unknown, label = '连接会话 ID') {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label}必须是大于等于 0 的整数`)
  }
  return parsed
}

function normalizeAntennaSelection(input: string | number[], antennaCount = Number.POSITIVE_INFINITY) {
  const rawValues = Array.isArray(input) ? input : input.split(/[,\s，]+/)

  return [...new Set(
    rawValues
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0 && item <= antennaCount)
  )]
}

function parseAntennas(input: string, antennaCount = Number.POSITIVE_INFINITY) {
  const ants = normalizeAntennaSelection(input, antennaCount)
  if (!ants.length) {
    throw new Error('请选择至少一个有效天线')
  }

  return ants
}

function syncDeviceAntNum() {
  const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
  guoxinDevice.setAntNum(rfidConfig.value.antennaCount, connectionSessionId)
}

function handleTagData(data: IRFIDTagReadMessage | null) {
  if (!data) return
  latestTag.value = data
  appendLog(`标签 EPC=${data.epc} 天线=${data.antennaId} RSSI=${data.rssi?.value ?? '-'}`)
}

async function startSingleRead() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    syncDeviceAntNum()
    inventoryStatus.value = '单次读取中'
    const antennas = parseAntennas(rfidConfig.value.antsInput, rfidConfig.value.antennaCount)
    const reason = await readEPC(antennas, handleTagData, connectionSessionId)
    inventoryStatus.value = reason ?? '单次读取完成'
    appendLog(`会话[${connectionSessionId}]单次读取结束: ${inventoryStatus.value}`)
  } catch (error) {
    const messageText = resolveError(error)
    inventoryStatus.value = '读取失败'
    appendLog(`单次读取失败: ${messageText}`)
    notify('negative', messageText)
  }
}

function startContinuousRead() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    syncDeviceAntNum()
    stopContinuousRead?.()
    const antennas = parseAntennas(rfidConfig.value.antsInput, rfidConfig.value.antennaCount)
    stopContinuousRead = readEPCContinuous(antennas, handleTagData, connectionSessionId) ?? null
    inventoryStatus.value = '连续读取中'
    appendLog(`会话[${connectionSessionId}]开始连续读取: 天线 ${antennas.join(',')}`)
  } catch (error) {
    const messageText = resolveError(error)
    inventoryStatus.value = '读取失败'
    appendLog(`连续读取失败: ${messageText}`)
    notify('negative', messageText)
  }
}

async function stopInventory() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    await stopReadEPC(connectionSessionId)
    stopContinuousRead?.()
    stopContinuousRead = null
    inventoryStatus.value = '已停止'
    appendLog(`会话[${connectionSessionId}]停止盘存成功`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`停止读取失败: ${messageText}`)
    notify('negative', messageText)
  }
}

async function prepareWriteMode() {
  const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
  if (inventoryStatus.value !== '空闲' || stopContinuousRead) {
    try {
      await stopReadEPC(connectionSessionId)
      appendLog(`会话[${connectionSessionId}]写标签前已停止盘存`)
    } catch {
      // 设备未处于盘存态时忽略停止失败，继续写入。
    }
  }
  stopContinuousRead?.()
  stopContinuousRead = null
  inventoryStatus.value = '空闲'
}

function buildWritePayload() {
  return {
    antenna: rfidConfig.value.writeAntenna,
    tid: requireHexValue(rfidConfig.value.writeTid, 'TID'),
    epc: requireHexValue(rfidConfig.value.writeEpc, 'EPC'),
    accessPassword: requireHexValue(rfidConfig.value.accessPassword, '访问密码', 8)
  }
}

function useLatestTagForWrite() {
  if (!latestTag.value) {
    notify('negative', '还没有可用的标签数据')
    return
  }
  const nextConfig: Partial<GuoxinRfidConfig> = {
    writeEpc: latestTag.value.epc
  }
  if (latestTag.value.tidData?.data) {
    nextConfig.writeTid = latestTag.value.tidData.data
  }
  if (latestTag.value.antennaId > 0) {
    nextConfig.writeAntenna = latestTag.value.antennaId
  }
  rfidStore.setConfig(nextConfig)
  appendLog('已带入最近读取到的标签 TID/EPC/天线')
}

function randomizeWriteEpc() {
  const currentValue = normalizeHex(rfidConfig.value.writeEpc)
  const targetLength =
    currentValue && /^[0-9A-F]+$/.test(currentValue) && currentValue.length % 2 === 0
      ? currentValue.length
      : DEFAULT_WRITE_EPC_DEMO.length
  const nextValue = randomHex(targetLength)
  rfidStore.setConfig({writeEpc: nextValue})
  appendLog(`已生成随机待写 EPC: ${nextValue}`)
}

async function firstWriteTag() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    syncDeviceAntNum()
    await prepareWriteMode()
    const payload = buildWritePayload()
    await writeEPCFirstTime({
      ants: [payload.antenna],
      newData: payload.epc,
      tid: payload.tid,
      accessPassword: payload.accessPassword,
      oldAccessPassword: requireHexValue(rfidConfig.value.oldAccessPassword, '旧访问密码', 8),
      killPassword: requireHexValue(rfidConfig.value.killPassword, '灭活密码', 8),
      sessionId: connectionSessionId,
      onProgress: appendLog
    })
    rfidStore.setConfig({oldAccessPassword: payload.accessPassword})
    appendLog(`会话[${connectionSessionId}]首次写入完成`)
    notify('positive', '首次写入完成')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`首次写入失败: ${messageText}`)
    notify('negative', messageText)
  }
}

async function rewriteTag() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    syncDeviceAntNum()
    await prepareWriteMode()
    const payload = buildWritePayload()
    await writeEPC(
        [payload.antenna],
        payload.epc,
        payload.tid,
        payload.accessPassword,
        connectionSessionId
    )
    appendLog(`会话[${connectionSessionId}]再次写入成功`)
    notify('positive', '再次写入成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`再次写入失败: ${messageText}`)
    notify('negative', messageText)
  }
}

async function applyPowerConfig() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    powerSubmitting.value = true
    syncDeviceAntNum()
    const powerLevels = [...powerEditor.value]
    rfidStore.setConfig({powerLevels})
    await configPower(powerLevels, connectionSessionId)
    appendLog(`会话[${connectionSessionId}]设置功率完成: ${formatPowerLevels(powerLevels)}`)
    powerModalVisible.value = false
    notify('positive', '功率配置成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`设置功率失败: ${messageText}`)
    notify('negative', messageText)
  } finally {
    powerSubmitting.value = false
  }
}

async function loadAllPower() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    const powerLevels = await readAllAntOutputPower(connectionSessionId)
    if (powerLevels.length) {
      rfidStore.setConfig({
        antennaCount: powerLevels.length,
        powerLevels
      })
    }
    appendLog(`会话[${connectionSessionId}]读取功率成功: ${powerLevels.length ? formatPowerLevels(powerLevels) : '无数据'}`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`读取功率失败: ${messageText}`)
    notify('negative', messageText)
  }
}

async function applyBasebandConfig() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    await configEPCBasebandParam(
        rfidConfig.value.epcBasebandRate,
        rfidConfig.value.defaultQ,
        rfidConfig.value.session,
        rfidConfig.value.inventoryFlag,
        connectionSessionId
    )
    appendLog(`会话[${connectionSessionId}]EPC 基带参数配置成功`)
    notify('positive', 'EPC 基带参数配置成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`配置 EPC 基带参数失败: ${messageText}`)
    notify('negative', messageText)
  }
}

function sendRawHex() {
  try {
    const connectionSessionId = requireSessionId(rfidConfig.value.connectionSessionId)
    const payload = normalizeHex(rfidConfig.value.rawHex)
    if (!payload) {
      throw new Error('请输入待发送的 HEX')
    }
    guoxinDevice.sendMessageNew(payload, connectionSessionId)
    appendLog(`会话[${connectionSessionId}]TX: ${payload}`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`发送失败: ${messageText}`)
    notify('negative', messageText)
  }
}

function clearLog() {
  log.value = ''
}

watch(
  [() => rfidConfig.value.mode, () => rfidConfig.value.connectionSessionId, connectionProfiles],
  ([nextMode, nextSessionId]) => {
    const resolvedSessionId = resolveSessionIdForMode(nextMode, nextSessionId)
    if (resolvedSessionId !== nextSessionId) {
      rfidStore.setConfig({connectionSessionId: resolvedSessionId})
      return
    }

    const sessionId = requireSessionId(resolvedSessionId)
    if (activeRfidSessionId.value !== sessionId) {
      deviceConnectionsStore.setActiveRfidSession(sessionId)
    }

    syncConnectionSnapshot(nextMode, sessionId)
  },
  {deep: true, immediate: true}
)

watch(activeRfidSessionId, (nextSessionId) => {
  if (rfidConfig.value.connectionSessionId === nextSessionId) {
    return
  }

  const profile = deviceConnectionsStore.getProfileBySessionId(nextSessionId)
  rfidStore.setConfig({
    connectionSessionId: nextSessionId,
    mode: profile?.mode ?? rfidConfig.value.mode
  })
}, {immediate: true})

watch(() => rfidConfig.value.antennaCount, (nextCount) => {
  syncDeviceAntNum()
  const antennas = normalizeAntennaSelection(rfidConfig.value.antsInput, nextCount)
  const nextValue = antennas.join(',')
  if (nextValue !== rfidConfig.value.antsInput) {
    rfidStore.setConfig({antsInput: nextValue})
  }
})

onMounted(() => {
  const sessionId = requireSessionId(rfidConfig.value.connectionSessionId)
  syncConnectionSnapshot(rfidConfig.value.mode, sessionId)

  disposeStatusListener = guoxinDevice.subscribeStatus((state) => {
    if (state.sessionId !== rfidConfig.value.connectionSessionId) {
      return
    }
    connected.value = state.connected
    currentMode.value = state.mode
    lastError.value = state.lastError ?? ''
  })

  disposeRawListener = guoxinDevice.subscribeRawData((sessionId, source, data) => {
    if (sessionId !== rfidConfig.value.connectionSessionId || source !== rfidConfig.value.mode) return
    appendLog(`会话[${sessionId}] ${source.toUpperCase()} RX: ${data}`)
  })
})

onUnmounted(() => {
  stopContinuousRead?.()
  disposeStatusListener()
  disposeRawListener()
})
</script>

<template>
  <div class="container">
    <div class="page-stack">
      <div class="layout-row layout-row-top">
        <q-card flat bordered class="panel-card">
          <q-card-section>
            <div class="panel-title">会话与状态</div>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <q-btn-toggle
                :model-value="rfidConfig.mode"
                no-caps
                rounded
                unelevated
                toggle-color="primary"
                :options="CONNECTION_MODE_OPTIONS"
                @update:model-value="handleConnectionModeChange"
            />

            <q-select
                :model-value="selectedConnectionProfile?.sessionId ?? null"
                outlined
                emit-value
                map-options
                :options="connectionSessionOptions"
                label="连接会话 ID"
                placeholder="选择当前连接方式下的 sessionId"
                @update:model-value="handleConnectionSessionChange"
            />

            <div class="action-buttons">
              <q-chip square dense :color="connected ? 'positive' : 'negative'" text-color="white">
                {{ connected ? '已连接' : '未连接' }}
              </q-chip>
              <q-chip square dense color="primary" text-color="white">
                {{ formatConnectionModeLabel(currentMode) }}
              </q-chip>
            </div>
            <div class="muted-text">{{ connectionSessionHint }}</div>
            <div class="muted-text">当前页面按所选连接方式调用对应会话：TCP 走 TCP session，Serial 走串口 session。</div>

            <q-banner
                v-if="lastError"
                rounded
                dense
                class="error-banner"
            >
              {{ lastError }}
            </q-banner>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="panel-card">
          <q-card-section>
            <div class="panel-title">功率与参数</div>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <q-input
                v-model.number="antennaCountModel"
                outlined
                type="number"
                min="1"
                max="32"
                label="天线数"
            />

            <q-separator />

            <div class="muted-text">
              {{ formatPowerLevels(rfidConfig.powerLevels) }}
            </div>
            <div class="action-buttons">
              <q-btn outline color="primary" no-caps @click="openPowerConfigModal">设置功率</q-btn>
              <q-btn outline color="primary" no-caps @click="loadAllPower">读取功率</q-btn>
            </div>

            <q-separator />

            <q-input
                v-model.number="rfidConfig.epcBasebandRate"
                outlined
                type="number"
                min="0"
                max="255"
                label="基带速率"
            />
            <q-input
                v-model.number="rfidConfig.defaultQ"
                outlined
                type="number"
                min="0"
                max="255"
                label="默认Q"
            />
            <q-input
                v-model.number="rfidConfig.session"
                outlined
                type="number"
                min="0"
                max="255"
                label="EPC Session"
            />
            <q-input
                v-model.number="rfidConfig.inventoryFlag"
                outlined
                type="number"
                min="0"
                max="255"
                label="盘存标志"
            />
            <q-btn outline color="primary" no-caps @click="applyBasebandConfig">配置 EPC 基带参数</q-btn>
          </q-card-section>
        </q-card>
      </div>

      <div class="layout-row layout-row-bottom">
        <q-card flat bordered class="panel-card">
          <q-card-section class="panel-title-row">
            <div class="panel-title">盘存测试</div>
            <q-chip square dense color="primary" text-color="white">{{ inventoryStatus }}</q-chip>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <q-select
                v-model="inventoryAntennasModel"
                outlined
                emit-value
                map-options
                multiple
                use-chips
                :options="inventoryAntennaOptions"
                label="盘存天线"
                placeholder="选择盘存天线"
            />
            <div class="action-buttons">
              <q-btn color="primary" no-caps unelevated @click="startSingleRead">单次读取</q-btn>
              <q-btn outline color="primary" no-caps @click="startContinuousRead">连续读取</q-btn>
              <q-btn color="negative" no-caps unelevated @click="stopInventory">停止读取</q-btn>
            </div>
            <div v-if="latestTag" class="info-panel">
              <div class="info-panel__title">最近标签</div>
              <div class="info-list">
                <div class="info-row"><span>EPC</span><code>{{ latestTag.epc }}</code></div>
                <div class="info-row"><span>PC</span><code>{{ latestTag.pcValue }}</code></div>
                <div class="info-row"><span>天线</span><strong>{{ latestTag.antennaId }}</strong></div>
                <div class="info-row"><span>RSSI</span><strong>{{ latestTag.rssi?.value ?? '-' }}</strong></div>
                <div class="info-row"><span>TID</span><code>{{ latestTag.tidData?.data ?? '-' }}</code></div>
              </div>
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="panel-card">
          <q-card-section>
            <div class="panel-title">写标签测试</div>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <q-banner rounded dense class="info-banner">
              首次写入会依次执行：改密码 -> 锁灭活/认证/EPC/用户区 -> 写 EPC；再次写入直接走 writeEPC。
            </q-banner>
            <q-select
                v-model="writeAntennaModel"
                outlined
                emit-value
                map-options
                :options="inventoryAntennaOptions"
                label="写入天线"
                placeholder="选择写入天线"
            />
            <q-input
                v-model="rfidConfig.writeTid"
                outlined
                label="标签 TID"
                placeholder="标签 TID，HEX"
            />
            <div class="write-epc-row">
              <q-input
                  v-model="rfidConfig.writeEpc"
                  outlined
                  class="field-grow"
                  label="待写 EPC"
                  placeholder="待写 EPC，HEX，例如 192012345678901234567895"
              />
              <q-btn outline color="primary" no-caps @click="randomizeWriteEpc">随机生成</q-btn>
            </div>
            <q-input
                v-model="rfidConfig.accessPassword"
                outlined
                label="访问密码"
                placeholder="访问密码，8位HEX"
            />
            <q-input
                v-model="rfidConfig.oldAccessPassword"
                outlined
                label="旧访问密码"
                placeholder="旧访问密码，8位HEX，仅首次写入使用"
            />
            <q-input
                v-model="rfidConfig.killPassword"
                outlined
                label="灭活密码"
                placeholder="灭活密码，8位HEX"
            />
            <div class="action-buttons">
              <q-btn outline color="primary" no-caps @click="useLatestTagForWrite">带入最近标签</q-btn>
              <q-btn color="primary" no-caps unelevated @click="firstWriteTag">首次写入</q-btn>
              <q-btn outline color="primary" no-caps @click="rewriteTag">再次写入</q-btn>
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="panel-card">
          <q-card-section>
            <div class="panel-title">原始 HEX 调试</div>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <q-input
                v-model="rfidConfig.rawHex"
                outlined
                label="原始 HEX"
                placeholder="输入原始 HEX 帧"
            />
            <div class="action-buttons">
              <q-btn outline color="primary" no-caps @click="sendRawHex">发送 HEX</q-btn>
              <q-btn color="negative" no-caps unelevated @click="clearLog">清空日志</q-btn>
            </div>
            <q-input
                v-model="log"
                outlined
                autogrow
                readonly
                type="textarea"
                rows="12"
                class="log-textarea"
                placeholder="收发日志"
            />
          </q-card-section>
        </q-card>
      </div>
    </div>

    <q-dialog v-model="powerModalVisible">
      <q-card flat bordered class="dialog-card">
        <q-card-section>
          <div class="panel-title">设置天线功率</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <div class="muted-text">
          当前设备天线数：{{ rfidConfig.antennaCount }}
          </div>
        <div class="power-grid">
          <q-input
              v-for="(_, index) in powerEditor"
              :key="`power-editor-${index}`"
              v-model.number="powerEditor[index]"
              outlined
              type="number"
              min="0"
              max="33"
              :label="`天线${index + 1}`"
          />
        </div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn flat no-caps @click="powerModalVisible = false">取消</q-btn>
          <q-btn color="primary" no-caps unelevated :loading="powerSubmitting" @click="applyPowerConfig">确定</q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
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

.layout-row {
  display: grid;
  gap: 16px;
  align-items: stretch;
}

.layout-row > .panel-card {
  height: 100%;
}

.layout-row-top {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.layout-row-bottom {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel-card {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 16px;
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
}

.panel-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-grow {
  flex: 1;
  min-width: 0;
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.muted-text {
  color: var(--app-text-secondary);
}

.error-banner {
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.14);
  color: rgb(185, 28, 28);
}

.info-banner {
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.14);
}

.info-panel {
  border: 1px solid var(--app-border);
  border-radius: 12px;
  padding: 12px;
}

.info-panel__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.info-list {
  display: flex;
  flex-direction: column;
}

.info-row {
  align-items: start;
  border-top: 1px solid var(--app-border);
  display: grid;
  gap: 12px;
  grid-template-columns: 88px minmax(0, 1fr);
  padding: 10px 0;
}

.info-row:first-child {
  border-top: none;
  padding-top: 0;
}

.info-row:last-child {
  padding-bottom: 0;
}

.info-row span {
  color: var(--app-text-secondary);
  font-size: 13px;
}

.write-epc-row {
  align-items: end;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.power-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dialog-card {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 16px;
  min-width: min(640px, 92vw);
}

@media (max-width: 1200px) {
  .layout-row-bottom {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .layout-row-top,
  .layout-row-bottom {
    grid-template-columns: minmax(0, 1fr);
  }

  .write-epc-row,
  .panel-title-row,
  .action-buttons {
    align-items: stretch;
    flex-direction: column;
  }

  .power-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.log-textarea :deep(textarea) {
  font-family: 'SFMono-Regular', 'Monaco', 'Consolas', monospace;
}
</style>

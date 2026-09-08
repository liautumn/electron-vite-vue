<script setup lang="ts">
import {storeToRefs} from 'pinia'
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {ElMessage} from 'element-plus'
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
  ElMessage[type === 'positive' ? 'success' : 'error'](String(content ?? ''))
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

  return `当前会话：${formatConnectionSessionLabel(profile)}`
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
  return `${profile.name} / Session ${profile.sessionId}`
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
  <div class="workspace-page">
    <div class="page-stack">
      <div class="layout-row layout-row-top">
        <section class="workspace-section">
          <div>
            <div class="panel-title">会话与状态</div>
          </div>
          <el-divider />
          <el-form label-position="top" class="panel-stack field-form">
            <el-segmented
                :model-value="rfidConfig.mode"
                :options="CONNECTION_MODE_OPTIONS"
                @update:model-value="handleConnectionModeChange"
            />

            <el-form-item label="连接会话 ID">
              <el-select
                  :model-value="selectedConnectionProfile?.sessionId ?? null"
                  placeholder="选择当前连接方式下的 sessionId"
                  @update:model-value="handleConnectionSessionChange"
              >
                <el-option v-for="option in connectionSessionOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </el-form-item>

            <div class="action-buttons">
              <el-tag :type="connected ? 'success' : 'danger'" effect="dark">
                {{ connected ? '已连接' : '未连接' }}
              </el-tag>
              <el-tag effect="dark">
                {{ formatConnectionModeLabel(currentMode) }}
              </el-tag>
            </div>
            <div class="muted-text">{{ connectionSessionHint }}</div>

            <el-alert
                v-if="lastError"
                :title="lastError"
                type="error"
                :closable="false"
                show-icon
                class="error-banner"
            />
          </el-form>
        </section>

        <section class="workspace-section">
          <div>
            <div class="panel-title">功率与参数</div>
          </div>
          <el-divider />
          <el-form label-position="top" class="panel-stack field-form">
            <div class="power-controls">
            <el-form-item label="天线数">
              <el-input-number v-model="antennaCountModel" :min="1" :max="32" controls-position="right" />
            </el-form-item>
            <div class="action-buttons">
              <el-button type="primary" plain @click="openPowerConfigModal">设置功率</el-button>
              <el-button type="primary" plain @click="loadAllPower">读取功率</el-button>
            </div>
            </div>

            <div class="muted-text">
              {{ formatPowerLevels(rfidConfig.powerLevels) }}
            </div>

            <div class="parameter-controls">
            <div class="parameter-grid">
              <el-form-item label="基带速率">
                <el-input-number v-model="rfidConfig.epcBasebandRate" :min="0" :max="255" controls-position="right" />
              </el-form-item>
              <el-form-item label="默认 Q">
                <el-input-number v-model="rfidConfig.defaultQ" :min="0" :max="255" controls-position="right" />
              </el-form-item>
              <el-form-item label="EPC Session">
                <el-input-number v-model="rfidConfig.session" :min="0" :max="255" controls-position="right" />
              </el-form-item>
              <el-form-item label="盘存标志">
                <el-input-number v-model="rfidConfig.inventoryFlag" :min="0" :max="255" controls-position="right" />
              </el-form-item>
            </div>
            <el-button type="primary" plain @click="applyBasebandConfig">配置 EPC 基带参数</el-button>
            </div>
          </el-form>
        </section>
      </div>

      <div class="layout-row layout-row-bottom">
        <section class="workspace-section">
          <div class="panel-title-row">
            <div class="panel-title">盘存测试</div>
            <el-tag effect="dark">{{ inventoryStatus }}</el-tag>
          </div>
          <el-divider />
          <el-form label-position="top" class="panel-stack field-form">
            <el-form-item label="盘存天线">
              <el-select
                  v-model="inventoryAntennasModel"
                  multiple
                  collapse-tags
                  placeholder="选择盘存天线"
              >
                <el-option v-for="option in inventoryAntennaOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </el-form-item>
            <div class="action-buttons">
              <el-button type="primary" @click="startSingleRead">单次读取</el-button>
              <el-button type="primary" plain @click="startContinuousRead">连续读取</el-button>
              <el-button type="danger" @click="stopInventory">停止读取</el-button>
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
          </el-form>
        </section>

        <section class="workspace-section">
          <div>
            <div class="panel-title">写标签测试</div>
          </div>
          <el-divider />
          <el-form label-position="top" class="panel-stack field-form">
            <el-alert title="首次写入将修改密码、锁定存储区并写入 EPC。" type="warning" :closable="false" show-icon />
            <el-form-item label="写入天线">
              <el-select
                  v-model="writeAntennaModel"
                  placeholder="选择写入天线"
              >
                <el-option v-for="option in inventoryAntennaOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="标签 TID">
              <el-input
                  v-model="rfidConfig.writeTid"
                  placeholder="标签 TID，HEX"
              />
            </el-form-item>
            <el-form-item label="待写 EPC">
              <div class="write-epc-row">
                <el-input
                    v-model="rfidConfig.writeEpc"
                    class="field-grow"
                    placeholder="待写 EPC，HEX，例如 192012345678901234567895"
                />
                <el-button type="primary" plain @click="randomizeWriteEpc">随机生成</el-button>
              </div>
            </el-form-item>
            <div class="password-grid">
            <el-form-item label="访问密码">
              <el-input v-model="rfidConfig.accessPassword" placeholder="访问密码，8位HEX" />
            </el-form-item>
            <el-form-item label="旧访问密码">
              <el-input v-model="rfidConfig.oldAccessPassword" placeholder="旧访问密码，8位HEX，仅首次写入使用" />
            </el-form-item>
            <el-form-item label="灭活密码">
              <el-input v-model="rfidConfig.killPassword" placeholder="灭活密码，8位HEX" />
            </el-form-item>
            </div>
            <div class="action-buttons">
              <el-button type="primary" plain @click="useLatestTagForWrite">带入最近标签</el-button>
              <el-button type="primary" @click="firstWriteTag">首次写入</el-button>
              <el-button type="primary" plain @click="rewriteTag">再次写入</el-button>
            </div>
          </el-form>
        </section>

        <section class="workspace-section debug-section">
          <div>
            <div class="panel-title">原始 HEX 调试</div>
          </div>
          <el-divider />
          <el-form label-position="top" class="panel-stack field-form">
            <el-form-item label="原始 HEX">
              <el-input
                  v-model="rfidConfig.rawHex"
                  placeholder="输入原始 HEX 帧"
              />
            </el-form-item>
            <div class="action-buttons">
              <el-button type="primary" plain @click="sendRawHex">发送 HEX</el-button>
              <el-button type="danger" @click="clearLog">清空日志</el-button>
            </div>
            <el-input
                v-model="log"
                readonly
                type="textarea"
                :rows="12"
                class="log-textarea"
                placeholder="收发日志"
            />
          </el-form>
        </section>
      </div>
    </div>

    <el-dialog v-model="powerModalVisible" title="设置天线功率" width="min(720px, 90vw)">
      <div class="panel-stack">
        <el-text type="info">当前设备天线数：{{ rfidConfig.antennaCount }}</el-text>
        <el-form label-position="top" class="power-grid field-form">
          <el-form-item
              v-for="(_, index) in powerEditor"
              :key="`power-editor-${index}`"
              :label="`天线${index + 1}`"
          >
            <el-input-number
                v-model="powerEditor[index]"
                :min="0"
                :max="33"
                controls-position="right"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="powerModalVisible = false">取消</el-button>
        <el-button type="primary" :loading="powerSubmitting" @click="applyPowerConfig">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.layout-row {
  display: grid;
  gap: 16px;
  align-items: start;
}

.layout-row-top {
  grid-template-columns: minmax(0, 400px) minmax(0, 1fr);
}

.layout-row-bottom {
  grid-template-columns: minmax(0, 400px) minmax(0, 1fr);
}

.debug-section {
  grid-column: 1 / -1;
}

.workspace-section :deep(.el-divider--horizontal) {
  margin: 12px 0 16px;
}

.panel-stack :deep(.el-select) {
  max-width: 360px;
}

.power-grid :deep(.el-input-number) {
  width: 100%;
}

.parameter-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(120px, 144px));
}

.power-controls,
.parameter-controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}

.parameter-controls {
  border-top: 1px solid var(--app-border);
  padding-top: 16px;
}

.parameter-grid {
  flex: 1 1 600px;
}

.password-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.field-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.field-form :deep(.el-form-item__label) {
  color: var(--app-text-secondary);
  line-height: 20px;
  margin-bottom: 6px;
  padding: 0;
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
  border-radius: 4px;
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
  width: 100%;
}

.power-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 1100px) {
  .layout-row-top,
  .layout-row-bottom {
    grid-template-columns: minmax(0, 1fr);
  }

}

@media (max-width: 480px) {
  .password-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .power-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.log-textarea :deep(textarea) {
  font-family: 'SFMono-Regular', 'Monaco', 'Consolas', monospace;
}
</style>

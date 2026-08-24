<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { lockDevice } from '../components/lock/LockDevice'
import {
  formatLockHex,
  getLockFrameLabel,
  resolveLockFrameStatusText,
  toLockHexByte,
  type LockParsedFrame
} from '../components/lock/LockProtocol'
import {
  disableLockKeepOpen,
  enableLockKeepOpen,
  openLock,
  queryLockStatus,
  sendLockRawHex
} from '../components/lock/LockHelper'
import { useDeviceConnectionsStore, type DeviceConnectionProfile } from '../stores/deviceConnections'

defineOptions({ name: 'lock-demo' })

// 三个业务模块共用的地址配置结构。
type LockTargetConfig = {
  boardAddress: number | null
  lockAddress: number | null
}

// 页面右侧反馈表统一使用的展示数据结构。
type FeedbackPanelData = {
  typeLabel: string
  rawHex: string
  statusText: string
  bccText: string
}

// 页面初次加载时先从单例设备中恢复一份快照。
const snapshot = lockDevice.getSnapshot()
const deviceConnectionsStore = useDeviceConnectionsStore()
const { activeLockSessionId, connectionProfiles } = storeToRefs(deviceConnectionsStore)

// 会话连接状态。
const connected = ref(snapshot.connected)
const lastError = ref(snapshot.lastError ?? '')
const sessionId = ref<number | null>(snapshot.sessionId)
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

  return `当前会话：${formatConnectionSessionLabel(profile)}`
})

// 三个模块分别维护自己的板地址和锁地址。
const normalLockTarget = reactive<LockTargetConfig>({
  boardAddress: 1,
  lockAddress: 1
})

const magneticLockTarget = reactive<LockTargetConfig>({
  boardAddress: 1,
  lockAddress: 2
})

const microswitchTarget = reactive<LockTargetConfig>({
  boardAddress: 1,
  lockAddress: 2
})

// 三个模块各自最近一次展示用的反馈数据。
const latestNormalLockFrame = ref<LockParsedFrame | null>(null)
const latestMagneticLockFrame = ref<LockParsedFrame | null>(null)
const latestMicroswitchFrame = ref<LockParsedFrame | null>(null)
const latestMagneticRawResponse = ref('')

// 页面卸载时需要取消订阅的回调。
let disposeStatusListener = () => {}
let disposeFrameListener = () => {}

const notify = (type: 'positive' | 'negative', content: unknown) => {
  ElMessage[type === 'positive' ? 'success' : 'error'](String(content ?? ''))
}

// 普通锁反馈表：开锁、查询状态、手动关锁都复用这一块。
const normalLockPanel = computed<FeedbackPanelData>(() => {
  const frame = latestNormalLockFrame.value
  if (!frame) {
    return buildEmptyPanel()
  }

  const isCloseFeedback = frame.header === '81'
  return {
    typeLabel: isCloseFeedback ? '手动关锁反馈' : getLockFrameLabel(frame),
    rawHex: formatLockHex(frame.rawHex),
    statusText: `0x${frame.statusHex} / ${isCloseFeedback ? resolveNormalLockCloseFeedbackText(frame) : resolveLockFrameStatusText(frame)}`,
    bccText: frame.bccValid ? '通过' : `错误，应为 0x${frame.expectedBccHex}`
  }
})

// 电磁锁反馈表：优先展示已解析帧，解析不到时退回原始 HEX。
const magneticLockPanel = computed<FeedbackPanelData>(() => {
  const frame = latestMagneticLockFrame.value
  if (frame) {
    return {
      typeLabel: getLockFrameLabel(frame),
      rawHex: formatLockHex(frame.rawHex),
      statusText: `0x${frame.statusHex} / ${resolveLockFrameStatusText(frame)}`,
      bccText: frame.bccValid ? '通过' : `错误，应为 0x${frame.expectedBccHex}`
    }
  }

  if (latestMagneticRawResponse.value) {
    return {
      typeLabel: '原始反馈',
      rawHex: formatLockHex(latestMagneticRawResponse.value),
      statusText: '',
      bccText: ''
    }
  }

  return buildEmptyPanel()
})

// 微动开关反馈表：只展示 81 主动上报。
const microswitchPanel = computed<FeedbackPanelData>(() => {
  const frame = latestMicroswitchFrame.value
  if (!frame) {
    return buildEmptyPanel()
  }

  return {
    typeLabel: '微动开关反馈',
    rawHex: formatLockHex(frame.rawHex),
    statusText: `0x${frame.statusHex} / ${resolveMicroswitchText(frame)}`,
    bccText: frame.bccValid ? '通过' : `错误，应为 0x${frame.expectedBccHex}`
  }
})

// 统一追加日志，只记录完整 TX/RX HEX。
function appendLog(messageText: string) {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  log.value += `[${stamp}] ${messageText}\n`
}

// 把 unknown 错误收敛成页面可提示的文本。
function resolveError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeSessionId(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

function formatConnectionSessionLabel(profile: Extract<DeviceConnectionProfile, { mode: 'serial' }>) {
  return `${profile.name} / Session ${profile.sessionId}`
}

function getSerialConnectionProfiles() {
  return connectionProfiles.value
    .filter((profile): profile is Extract<DeviceConnectionProfile, { mode: 'serial' }> => profile.mode === 'serial')
    .sort((left, right) => left.sessionId - right.sessionId)
}

function resolveSerialSessionId(preferredSessionId?: unknown) {
  const profiles = getSerialConnectionProfiles()
  const normalizedPreferredSessionId = normalizeSessionId(preferredSessionId)

  return profiles.find((profile) => profile.sessionId === normalizedPreferredSessionId)?.sessionId
    ?? profiles[0]?.sessionId
    ?? null
}

function syncSessionSnapshot(targetSessionId: number | null) {
  if (targetSessionId === null) {
    connected.value = false
    lastError.value = ''
    return
  }

  lockDevice.setActiveSession(targetSessionId)
  const currentSnapshot = lockDevice.getSnapshot(targetSessionId)
  connected.value = currentSnapshot.connected
  lastError.value = currentSnapshot.lastError ?? ''
}

function handleSessionChange(nextSessionId: number | null) {
  sessionId.value = resolveSerialSessionId(nextSessionId)
}

// 校验板地址、锁地址这类单字节数值输入。
function requireAddressValue(value: number | null, label: string) {
  if (value === null || value === undefined) {
    throw new Error(`${label}不能为空`)
  }
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
    throw new Error(`${label}必须是 0-255 的整数`)
  }
  return value
}

// 校验连接会话 ID。
function requireSessionId(value: number | null) {
  if (value === null || value === undefined) {
    throw new Error('会话 ID 不能为空')
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('会话 ID 必须是大于等于 0 的整数')
  }
  return value
}

function requireConnectionSessionSelection(value: unknown) {
  return normalizeSessionId(value) !== null || '请选择串口会话'
}

// 读取某个模块当前生效的板地址和锁地址。
function getTargetAddress(target: LockTargetConfig, label: string) {
  return {
    board: requireAddressValue(target.boardAddress, `${label}板地址`),
    lock: requireAddressValue(target.lockAddress, `${label}锁地址`)
  }
}

// 判断一帧响应是否属于某个模块当前配置的地址。
function matchesTarget(frame: LockParsedFrame, target: LockTargetConfig) {
  if (!Number.isInteger(target.boardAddress) || !Number.isInteger(target.lockAddress)) {
    return false
  }

  return frame.boardAddress === target.boardAddress && frame.lockAddress === target.lockAddress
}

// 在页面上显示当前地址的十六进制预览。
function formatTargetPreview(target: LockTargetConfig) {
  try {
    const { board, lock } = getTargetAddress(target, '')
    return `板地址 0x${toLockHexByte(board, '板地址')} / 锁地址 0x${toLockHexByte(lock, '锁地址')}`
  } catch {
    return '请填写有效的板地址和锁地址'
  }
}

// 普通锁模块里，81 响应按“手动关锁反馈”来解释。
function resolveNormalLockCloseFeedbackText(frame: LockParsedFrame) {
  if (frame.statusHex === '00') {
    return '手动关锁反馈 / 状态位 00'
  }
  if (frame.statusHex === '11') {
    return '手动关锁反馈 / 状态位 11'
  }
  return `手动关锁反馈 / 状态位 ${frame.statusHex}`
}

// 微动开关模块固定按微动状态解释 81 响应。
function resolveMicroswitchText(frame: LockParsedFrame) {
  if (frame.statusHex === '11') {
    return '微动按下'
  }
  if (frame.statusHex === '00') {
    return '微动松开'
  }
  return `微动状态 ${frame.statusHex}`
}

// 反馈表的空态结构，避免模板里写一堆空值判断。
function buildEmptyPanel(): FeedbackPanelData {
  return {
    typeLabel: '',
    rawHex: '',
    statusText: '',
    bccText: ''
  }
}

// 清空日志面板。
function clearLog() {
  log.value = ''
}

// 普通锁开锁。
async function handleOpenNormalLock() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const { board, lock } = getTargetAddress(normalLockTarget, '普通锁')
    const { commandHex, frame } = await openLock(board, lock, 2000, targetSessionId)
    latestNormalLockFrame.value = frame
    appendLog(`会话[${targetSessionId}] TX ${formatLockHex(commandHex)}`)
    notify('positive', resolveLockFrameStatusText(frame))
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 普通锁状态查询。
async function handleQueryNormalLockStatus() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const { board, lock } = getTargetAddress(normalLockTarget, '普通锁')
    const { commandHex, frame } = await queryLockStatus(board, lock, 2000, targetSessionId)
    latestNormalLockFrame.value = frame
    appendLog(`会话[${targetSessionId}] TX ${formatLockHex(commandHex)}`)
    notify('positive', resolveLockFrameStatusText(frame))
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 电磁锁开启长通电。
async function handleEnableMagneticHoldOpen() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const { board, lock } = getTargetAddress(magneticLockTarget, '电磁锁')
    const { commandHex, rawResponseHex, parsedResponse } = await enableLockKeepOpen(board, lock, 2000, targetSessionId)
    const commandFrames = parsedResponse.parsedFrames.filter((frame) => frame.header === '9A')

    latestMagneticRawResponse.value = rawResponseHex
    appendLog(`会话[${targetSessionId}] TX ${formatLockHex(commandHex)}`)

    if (commandFrames.length) {
      const latestFrame = commandFrames[commandFrames.length - 1]
      latestMagneticLockFrame.value = latestFrame
      if (rawResponseHex) {
        appendLog(`会话[${targetSessionId}] RX ${formatLockHex(rawResponseHex)}`)
      }
      notify('positive', resolveLockFrameStatusText(latestFrame))
      return
    }

    if (rawResponseHex) {
      appendLog(`会话[${targetSessionId}] RX ${formatLockHex(rawResponseHex)}`)
      notify('positive', '开启长通电指令已发送，收到原始反馈')
      return
    }

    notify('positive', '开启长通电指令已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 电磁锁关闭长通电。
async function handleDisableMagneticHoldOpen() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const { board, lock } = getTargetAddress(magneticLockTarget, '电磁锁')
    const { commandHex, rawResponseHex, parsedResponse } = await disableLockKeepOpen(board, lock, 2000, targetSessionId)
    const commandFrames = parsedResponse.parsedFrames.filter((frame) => frame.header === '9B')

    latestMagneticRawResponse.value = rawResponseHex
    appendLog(`会话[${targetSessionId}] TX ${formatLockHex(commandHex)}`)

    if (commandFrames.length) {
      const latestFrame = commandFrames[commandFrames.length - 1]
      latestMagneticLockFrame.value = latestFrame
      if (rawResponseHex) {
        appendLog(`会话[${targetSessionId}] RX ${formatLockHex(rawResponseHex)}`)
      }
      notify('positive', resolveLockFrameStatusText(latestFrame))
      return
    }

    if (rawResponseHex) {
      appendLog(`会话[${targetSessionId}] RX ${formatLockHex(rawResponseHex)}`)
      notify('positive', '关闭长通电指令已发送，收到原始反馈')
      return
    }

    notify('positive', '关闭长通电指令已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 发送自定义 HEX，方便联调补测。
async function handleSendRawHex() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const commandHex = await sendLockRawHex(rawHex.value, targetSessionId)
    appendLog(`会话[${targetSessionId}] TX ${formatLockHex(commandHex)}`)
    notify('positive', '自定义 HEX 已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 把收到的结构化帧按地址归档到对应模块。
function routeIncomingFrame(incomingSessionId: number, frame: LockParsedFrame) {
  appendLog(`会话[${incomingSessionId}] RX ${formatLockHex(frame.rawHex)}`)

  const activeSession = Number(sessionId.value)
  if (!Number.isInteger(activeSession) || activeSession < 0) {
    return
  }

  if (incomingSessionId !== activeSession) {
    return
  }

  if (frame.header === '81' && matchesTarget(frame, normalLockTarget)) {
    latestNormalLockFrame.value = frame
  }

  if (frame.header === '81' && matchesTarget(frame, microswitchTarget)) {
    latestMicroswitchFrame.value = frame
  }

  if ((frame.header === '8A' || frame.header === '80') && matchesTarget(frame, normalLockTarget)) {
    latestNormalLockFrame.value = frame
  }

  if ((frame.header === '9A' || frame.header === '9B') && matchesTarget(frame, magneticLockTarget)) {
    latestMagneticLockFrame.value = frame
  }
}

// 页面挂载时订阅设备状态/响应帧。
onMounted(() => {
  disposeStatusListener = lockDevice.subscribeStatus((state) => {
    const activeSessionId = normalizeSessionId(sessionId.value)
    if (activeSessionId === null || state.sessionId !== activeSessionId) {
      return
    }
    connected.value = state.connected
    lastError.value = state.lastError ?? ''
  })

  disposeFrameListener = lockDevice.subscribeFrame((incomingSessionId, frame) => {
    routeIncomingFrame(incomingSessionId, frame)
  })
})

watch(
  [sessionId, connectionProfiles],
  ([nextSessionId]) => {
    const resolvedSessionId = resolveSerialSessionId(nextSessionId)
    if (resolvedSessionId !== nextSessionId) {
      sessionId.value = resolvedSessionId
      return
    }

    if (resolvedSessionId === null) {
      syncSessionSnapshot(null)
      return
    }

    if (activeLockSessionId.value !== resolvedSessionId) {
      deviceConnectionsStore.setActiveLockSession(resolvedSessionId)
    }
    syncSessionSnapshot(resolvedSessionId)
  },
  { deep: true, immediate: true }
)

watch(
  activeLockSessionId,
  (nextSessionId) => {
    const resolvedSessionId = resolveSerialSessionId(nextSessionId)
    if (sessionId.value !== resolvedSessionId) {
      sessionId.value = resolvedSessionId
    }
  },
  { immediate: true }
)

// 页面卸载时释放订阅，避免重复监听。
onUnmounted(() => {
  disposeStatusListener()
  disposeFrameListener()
})
</script>

<template>
  <div class="container">
    <div class="page-stack">
      <el-card shadow="never" class="panel-card">
        <div class="panel-title-row">
          <div class="panel-title">会话与状态</div>
          <el-tag :type="connected ? 'success' : 'danger'" effect="dark">
            {{ connected ? '已连接' : '未连接' }}
          </el-tag>
        </div>
        <el-divider />
        <div class="panel-stack">
          <el-select
            :model-value="selectedConnectionProfile?.sessionId ?? null"
            placeholder="选择串口 sessionId"
            @update:model-value="handleSessionChange"
          >
            <el-option v-for="option in connectionSessionOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>

          <el-text type="info">{{ connectionSessionHint }}</el-text>
          <el-text type="info">锁控板页面仅支持串口会话，连接参数请在项目设置维护。</el-text>
          <el-alert v-if="lastError" :title="`最近错误：${lastError}`" type="error" :closable="false" show-icon />
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <div>
          <div class="panel-title">普通锁模块</div>
        </div>
        <el-divider />
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <el-input-number v-model="normalLockTarget.boardAddress" :min="0" :max="255" placeholder="普通锁板地址" controls-position="right" />
              <el-input-number v-model="normalLockTarget.lockAddress" :min="0" :max="255" placeholder="普通锁锁地址" controls-position="right" />
            </div>
            <el-text type="info">{{ formatTargetPreview(normalLockTarget) }}</el-text>
            <div class="action-buttons">
              <el-button type="primary" @click="handleOpenNormalLock">开锁</el-button>
              <el-button type="primary" plain @click="handleQueryNormalLockStatus">查询状态</el-button>
            </div>
          </div>
          <div class="module-column">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="反馈类型">{{ normalLockPanel.typeLabel || '-' }}</el-descriptions-item>
              <el-descriptions-item label="原始 HEX"><code>{{ normalLockPanel.rawHex || '-' }}</code></el-descriptions-item>
              <el-descriptions-item label="状态位">{{ normalLockPanel.statusText || '-' }}</el-descriptions-item>
              <el-descriptions-item label="BCC">{{ normalLockPanel.bccText || '-' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <div>
          <div class="panel-title">电磁锁模块</div>
        </div>
        <el-divider />
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <el-input-number v-model="magneticLockTarget.boardAddress" :min="0" :max="255" placeholder="电磁锁板地址" controls-position="right" />
              <el-input-number v-model="magneticLockTarget.lockAddress" :min="0" :max="255" placeholder="电磁锁锁地址" controls-position="right" />
            </div>
            <el-text type="info">{{ formatTargetPreview(magneticLockTarget) }}</el-text>
            <div class="action-buttons">
              <el-button type="primary" @click="handleEnableMagneticHoldOpen">开启长通电</el-button>
              <el-button type="primary" plain @click="handleDisableMagneticHoldOpen">关闭长通电</el-button>
            </div>
          </div>
          <div class="module-column">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="反馈类型">{{ magneticLockPanel.typeLabel || '-' }}</el-descriptions-item>
              <el-descriptions-item label="原始 HEX"><code>{{ magneticLockPanel.rawHex || '-' }}</code></el-descriptions-item>
              <el-descriptions-item label="状态位">{{ magneticLockPanel.statusText || '-' }}</el-descriptions-item>
              <el-descriptions-item label="BCC">{{ magneticLockPanel.bccText || '-' }}</el-descriptions-item>
            </el-descriptions>
            <el-text type="info">9A/9B 不强行按统一长度拆包。</el-text>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <div>
          <div class="panel-title">微动开关模块</div>
        </div>
        <el-divider />
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <el-input-number v-model="microswitchTarget.boardAddress" :min="0" :max="255" placeholder="微动板地址" controls-position="right" />
              <el-input-number v-model="microswitchTarget.lockAddress" :min="0" :max="255" placeholder="微动锁地址" controls-position="right" />
            </div>
            <el-text type="info">{{ formatTargetPreview(microswitchTarget) }}</el-text>
          </div>
          <div class="module-column">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="反馈类型">{{ microswitchPanel.typeLabel || '-' }}</el-descriptions-item>
              <el-descriptions-item label="原始 HEX"><code>{{ microswitchPanel.rawHex || '-' }}</code></el-descriptions-item>
              <el-descriptions-item label="状态位">{{ microswitchPanel.statusText || '-' }}</el-descriptions-item>
              <el-descriptions-item label="BCC">{{ microswitchPanel.bccText || '-' }}</el-descriptions-item>
            </el-descriptions>
            <el-text type="info">这里固定按微动事件展示：11=微动按下，00=微动松开。</el-text>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <div>
          <div class="panel-title">自定义 HEX</div>
        </div>
        <el-divider />
        <div class="panel-stack">
          <el-text type="info">自定义 HEX 会直接走当前串口会话发送，便于补测文档之外的命令。</el-text>
          <div class="serial-port-row">
            <el-input v-model="rawHex" class="field-grow" placeholder="例如：8A 01 01 11 9B" />
            <el-button type="primary" @click="handleSendRawHex">发送自定义 HEX</el-button>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <div class="panel-title-row">
          <div class="panel-title">通讯日志</div>
          <el-button type="danger" @click="clearLog">清空日志</el-button>
        </div>
        <el-divider />
        <div>
          <el-input
            :model-value="log"
            readonly
            type="textarea"
            :rows="16"
            class="log-textarea"
            placeholder="串口日志会显示在这里"
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

.address-grid :deep(.el-input-number) {
  width: 100%;
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

.serial-port-row {
  display: flex;
  gap: 12px;
  width: 100%;
  align-items: end;
  flex-wrap: wrap;
}

.field-grow {
  flex: 1;
  min-width: 240px;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.module-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.address-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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
  .module-grid,
  .address-grid {
    grid-template-columns: 1fr;
  }

  .serial-port-row,
  .panel-title-row,
  .action-buttons {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

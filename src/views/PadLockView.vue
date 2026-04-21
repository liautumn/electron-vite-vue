<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {Notify} from 'quasar'
import { padSingleDevice } from '../components/pad/PadSingleDevice'
import {
  formatPadHex,
  getPadFrameLabel,
  resolvePadFrameStatusText,
  toPadHexByte,
  type PadParsedFrame
} from '../components/pad/PadProtocol'
import {
  disablePadLockKeepOpen,
  enablePadLockKeepOpen,
  openPadLock,
  queryPadLockStatus,
  sendPadRawHex
} from '../components/pad/PadHelper'
import { useDeviceConnectionsStore } from '../stores/deviceConnections'

defineOptions({ name: 'pad-lock-demo' })

// 三个业务模块共用的地址配置结构。
type PadTargetConfig = {
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
const snapshot = padSingleDevice.getSnapshot()
const deviceConnectionsStore = useDeviceConnectionsStore()
const { activePadSessionId } = storeToRefs(deviceConnectionsStore)

// 会话连接状态。
const connected = ref(snapshot.connected)
const lastError = ref(snapshot.lastError ?? '')
const sessionId = ref<number | null>(snapshot.sessionId)
const rawHex = ref('')
const log = ref('')

// 三个模块分别维护自己的板地址和锁地址。
const normalLockTarget = reactive<PadTargetConfig>({
  boardAddress: 1,
  lockAddress: 1
})

const magneticLockTarget = reactive<PadTargetConfig>({
  boardAddress: 1,
  lockAddress: 2
})

const microswitchTarget = reactive<PadTargetConfig>({
  boardAddress: 1,
  lockAddress: 2
})

// 三个模块各自最近一次展示用的反馈数据。
const latestNormalLockFrame = ref<PadParsedFrame | null>(null)
const latestMagneticLockFrame = ref<PadParsedFrame | null>(null)
const latestMicroswitchFrame = ref<PadParsedFrame | null>(null)
const latestMagneticRawResponse = ref('')

// 页面卸载时需要取消订阅的回调。
let disposeStatusListener = () => {}
let disposeFrameListener = () => {}

const notify = (type: 'positive' | 'negative', content: unknown) => {
  Notify.create({
    type,
    message: String(content ?? ''),
    position: 'top-right',
    timeout: 2200
  })
}

// 普通锁反馈表：开锁、查询状态、手动关锁都复用这一块。
const normalLockPanel = computed<FeedbackPanelData>(() => {
  const frame = latestNormalLockFrame.value
  if (!frame) {
    return buildEmptyPanel()
  }

  const isCloseFeedback = frame.header === '81'
  return {
    typeLabel: isCloseFeedback ? '手动关锁反馈' : getPadFrameLabel(frame),
    rawHex: formatPadHex(frame.rawHex),
    statusText: `0x${frame.statusHex} / ${isCloseFeedback ? resolveNormalLockCloseFeedbackText(frame) : resolvePadFrameStatusText(frame)}`,
    bccText: frame.bccValid ? '通过' : `错误，应为 0x${frame.expectedBccHex}`
  }
})

// 电磁锁反馈表：优先展示已解析帧，解析不到时退回原始 HEX。
const magneticLockPanel = computed<FeedbackPanelData>(() => {
  const frame = latestMagneticLockFrame.value
  if (frame) {
    return {
      typeLabel: getPadFrameLabel(frame),
      rawHex: formatPadHex(frame.rawHex),
      statusText: `0x${frame.statusHex} / ${resolvePadFrameStatusText(frame)}`,
      bccText: frame.bccValid ? '通过' : `错误，应为 0x${frame.expectedBccHex}`
    }
  }

  if (latestMagneticRawResponse.value) {
    return {
      typeLabel: '原始反馈',
      rawHex: formatPadHex(latestMagneticRawResponse.value),
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
    rawHex: formatPadHex(frame.rawHex),
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

// 读取某个模块当前生效的板地址和锁地址。
function getTargetAddress(target: PadTargetConfig, label: string) {
  return {
    board: requireAddressValue(target.boardAddress, `${label}板地址`),
    lock: requireAddressValue(target.lockAddress, `${label}锁地址`)
  }
}

// 判断一帧响应是否属于某个模块当前配置的地址。
function matchesTarget(frame: PadParsedFrame, target: PadTargetConfig) {
  if (!Number.isInteger(target.boardAddress) || !Number.isInteger(target.lockAddress)) {
    return false
  }

  return frame.boardAddress === target.boardAddress && frame.lockAddress === target.lockAddress
}

// 在页面上显示当前地址的十六进制预览。
function formatTargetPreview(target: PadTargetConfig) {
  try {
    const { board, lock } = getTargetAddress(target, '')
    return `板地址 0x${toPadHexByte(board, '板地址')} / 锁地址 0x${toPadHexByte(lock, '锁地址')}`
  } catch {
    return '请填写有效的板地址和锁地址'
  }
}

// 普通锁模块里，81 响应按“手动关锁反馈”来解释。
function resolveNormalLockCloseFeedbackText(frame: PadParsedFrame) {
  if (frame.statusHex === '00') {
    return '手动关锁反馈 / 状态位 00'
  }
  if (frame.statusHex === '11') {
    return '手动关锁反馈 / 状态位 11'
  }
  return `手动关锁反馈 / 状态位 ${frame.statusHex}`
}

// 微动开关模块固定按微动状态解释 81 响应。
function resolveMicroswitchText(frame: PadParsedFrame) {
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
    const { commandHex, frame } = await openPadLock(board, lock, 2000, targetSessionId)
    latestNormalLockFrame.value = frame
    appendLog(`会话[${targetSessionId}] TX ${formatPadHex(commandHex)}`)
    notify('positive', resolvePadFrameStatusText(frame))
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 普通锁状态查询。
async function handleQueryNormalLockStatus() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const { board, lock } = getTargetAddress(normalLockTarget, '普通锁')
    const { commandHex, frame } = await queryPadLockStatus(board, lock, 2000, targetSessionId)
    latestNormalLockFrame.value = frame
    appendLog(`会话[${targetSessionId}] TX ${formatPadHex(commandHex)}`)
    notify('positive', resolvePadFrameStatusText(frame))
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 电磁锁开启长通电。
async function handleEnableMagneticHoldOpen() {
  try {
    const targetSessionId = requireSessionId(sessionId.value)
    const { board, lock } = getTargetAddress(magneticLockTarget, '电磁锁')
    const { commandHex, rawResponseHex, parsedResponse } = await enablePadLockKeepOpen(board, lock, 2000, targetSessionId)
    const commandFrames = parsedResponse.parsedFrames.filter((frame) => frame.header === '9A')

    latestMagneticRawResponse.value = rawResponseHex
    appendLog(`会话[${targetSessionId}] TX ${formatPadHex(commandHex)}`)

    if (commandFrames.length) {
      const latestFrame = commandFrames[commandFrames.length - 1]
      latestMagneticLockFrame.value = latestFrame
      if (rawResponseHex) {
        appendLog(`会话[${targetSessionId}] RX ${formatPadHex(rawResponseHex)}`)
      }
      notify('positive', resolvePadFrameStatusText(latestFrame))
      return
    }

    if (rawResponseHex) {
      appendLog(`会话[${targetSessionId}] RX ${formatPadHex(rawResponseHex)}`)
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
    const { commandHex, rawResponseHex, parsedResponse } = await disablePadLockKeepOpen(board, lock, 2000, targetSessionId)
    const commandFrames = parsedResponse.parsedFrames.filter((frame) => frame.header === '9B')

    latestMagneticRawResponse.value = rawResponseHex
    appendLog(`会话[${targetSessionId}] TX ${formatPadHex(commandHex)}`)

    if (commandFrames.length) {
      const latestFrame = commandFrames[commandFrames.length - 1]
      latestMagneticLockFrame.value = latestFrame
      if (rawResponseHex) {
        appendLog(`会话[${targetSessionId}] RX ${formatPadHex(rawResponseHex)}`)
      }
      notify('positive', resolvePadFrameStatusText(latestFrame))
      return
    }

    if (rawResponseHex) {
      appendLog(`会话[${targetSessionId}] RX ${formatPadHex(rawResponseHex)}`)
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
    const commandHex = await sendPadRawHex(rawHex.value, targetSessionId)
    appendLog(`会话[${targetSessionId}] TX ${formatPadHex(commandHex)}`)
    notify('positive', '自定义 HEX 已发送')
  } catch (error) {
    notify('negative', resolveError(error))
  }
}

// 把收到的结构化帧按地址归档到对应模块。
function routeIncomingFrame(incomingSessionId: number, frame: PadParsedFrame) {
  appendLog(`会话[${incomingSessionId}] RX ${formatPadHex(frame.rawHex)}`)

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
  const targetSessionId = requireSessionId(sessionId.value)
  padSingleDevice.setActiveSession(targetSessionId)
  const currentSnapshot = padSingleDevice.getSnapshot(targetSessionId)
  connected.value = currentSnapshot.connected
  lastError.value = currentSnapshot.lastError ?? ''

  disposeStatusListener = padSingleDevice.subscribeStatus((state) => {
    if (state.sessionId !== requireSessionId(sessionId.value)) {
      return
    }
    connected.value = state.connected
    lastError.value = state.lastError ?? ''
  })

  disposeFrameListener = padSingleDevice.subscribeFrame((incomingSessionId, frame) => {
    routeIncomingFrame(incomingSessionId, frame)
  })
})

watch(sessionId, (nextSessionId) => {
  const targetSessionId = requireSessionId(nextSessionId)
  if (activePadSessionId.value !== targetSessionId) {
    deviceConnectionsStore.setActivePadSession(targetSessionId)
  }
  padSingleDevice.setActiveSession(targetSessionId)
  const currentSnapshot = padSingleDevice.getSnapshot(targetSessionId)
  connected.value = currentSnapshot.connected
  lastError.value = currentSnapshot.lastError ?? ''
})

watch(activePadSessionId, (nextSessionId) => {
  if (sessionId.value !== nextSessionId) {
    sessionId.value = nextSessionId
  }
}, {immediate: true})

// 页面卸载时释放订阅，避免重复监听。
onUnmounted(() => {
  disposeStatusListener()
  disposeFrameListener()
})
</script>

<template>
  <div class="container">
    <div class="page-stack">
      <q-card flat bordered class="panel-card">
        <q-card-section class="panel-title-row">
          <div class="panel-title">会话与状态</div>
          <q-chip square dense :color="connected ? 'positive' : 'negative'" text-color="white">
            {{ connected ? '已连接' : '未连接' }}
          </q-chip>
        </q-card-section>
        <q-separator />
        <q-card-section class="panel-stack">
          <q-input
            v-model.number="sessionId"
            outlined
            type="number"
            min="0"
            step="1"
            label="连接会话 ID"
            placeholder="直接输入 sessionId"
          />

          <div class="muted-text">
            连接参数请在项目设置维护，当前页面仅按 sessionId 调用。
          </div>
          <div v-if="lastError" class="error-text">
            最近错误：{{ lastError }}
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">普通锁模块</div>
        </q-card-section>
        <q-separator />
        <q-card-section>
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <q-input
                v-model.number="normalLockTarget.boardAddress"
                outlined
                type="number"
                min="0"
                max="255"
                label="普通锁板地址"
              />
              <q-input
                v-model.number="normalLockTarget.lockAddress"
                outlined
                type="number"
                min="0"
                max="255"
                label="普通锁锁地址"
              />
            </div>

            <div class="muted-text">
              {{ formatTargetPreview(normalLockTarget) }}
            </div>

            <div class="action-buttons">
              <q-btn color="primary" no-caps unelevated @click="handleOpenNormalLock">开锁</q-btn>
              <q-btn outline color="primary" no-caps @click="handleQueryNormalLockStatus">查询状态</q-btn>
            </div>
          </div>

          <div class="module-column">
            <q-markup-table flat bordered dense class="feedback-table">
              <tbody>
                <tr><th>反馈类型</th><td>{{ normalLockPanel.typeLabel }}</td></tr>
                <tr><th>原始 HEX</th><td><code>{{ normalLockPanel.rawHex }}</code></td></tr>
                <tr><th>状态位</th><td>{{ normalLockPanel.statusText }}</td></tr>
                <tr><th>BCC</th><td>{{ normalLockPanel.bccText }}</td></tr>
              </tbody>
            </q-markup-table>
          </div>
        </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">电磁锁模块</div>
        </q-card-section>
        <q-separator />
        <q-card-section>
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <q-input
                v-model.number="magneticLockTarget.boardAddress"
                outlined
                type="number"
                min="0"
                max="255"
                label="电磁锁板地址"
              />
              <q-input
                v-model.number="magneticLockTarget.lockAddress"
                outlined
                type="number"
                min="0"
                max="255"
                label="电磁锁锁地址"
              />
            </div>

            <div class="muted-text">
              {{ formatTargetPreview(magneticLockTarget) }}
            </div>

            <div class="action-buttons">
              <q-btn color="primary" no-caps unelevated @click="handleEnableMagneticHoldOpen">开启长通电</q-btn>
              <q-btn outline color="primary" no-caps @click="handleDisableMagneticHoldOpen">关闭长通电</q-btn>
            </div>
          </div>

          <div class="module-column">
            <q-markup-table flat bordered dense class="feedback-table">
              <tbody>
                <tr><th>反馈类型</th><td>{{ magneticLockPanel.typeLabel }}</td></tr>
                <tr><th>原始 HEX</th><td><code>{{ magneticLockPanel.rawHex }}</code></td></tr>
                <tr><th>状态位</th><td>{{ magneticLockPanel.statusText }}</td></tr>
                <tr><th>BCC</th><td>{{ magneticLockPanel.bccText }}</td></tr>
              </tbody>
            </q-markup-table>
            <div class="muted-text">
              `9A/9B` 不强行按统一长度拆包。
            </div>
          </div>
        </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered class="panel-card">
        <q-card-section>
          <div class="panel-title">微动开关模块</div>
        </q-card-section>
        <q-separator />
        <q-card-section>
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <q-input
                v-model.number="microswitchTarget.boardAddress"
                outlined
                type="number"
                min="0"
                max="255"
                label="微动板地址"
              />
              <q-input
                v-model.number="microswitchTarget.lockAddress"
                outlined
                type="number"
                min="0"
                max="255"
                label="微动锁地址"
              />
            </div>

            <div class="muted-text">
              {{ formatTargetPreview(microswitchTarget) }}
            </div>
          </div>

          <div class="module-column">
            <q-markup-table flat bordered dense class="feedback-table">
              <tbody>
                <tr><th>反馈类型</th><td>{{ microswitchPanel.typeLabel }}</td></tr>
                <tr><th>原始 HEX</th><td><code>{{ microswitchPanel.rawHex }}</code></td></tr>
                <tr><th>状态位</th><td>{{ microswitchPanel.statusText }}</td></tr>
                <tr><th>BCC</th><td>{{ microswitchPanel.bccText }}</td></tr>
              </tbody>
            </q-markup-table>
            <div class="muted-text">
              这里固定按微动事件展示：`11=微动按下`，`00=微动松开`。
            </div>
          </div>
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
            自定义 HEX 会直接走当前串口发送，便于补测文档之外的命令。
          </div>
          <div class="serial-port-row">
            <q-input v-model="rawHex" outlined class="field-grow" label="命令 HEX" placeholder="例如：8A 01 01 11 9B" />
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
            rows="16"
            class="log-textarea"
            placeholder="串口日志会显示在这里"
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

.feedback-table {
  background: transparent;
  border-color: var(--app-border);
  border-radius: 12px;
}

.feedback-table :deep(th) {
  color: var(--app-text-secondary);
  width: 140px;
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

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { padSingleDevice } from '../components/pad/PadSingleDevice'
import {
  describePadFrame,
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

defineOptions({ name: 'pad-lock-demo' })

type PadTargetConfig = {
  boardAddress: number | null
  lockAddress: number | null
}

const snapshot = padSingleDevice.getSnapshot()

const connected = ref(snapshot.connected)
const lastError = ref(snapshot.lastError ?? '')
const portPath = ref(snapshot.portPath || '')
const baudRate = ref<number | null>(snapshot.baudRate || 9600)
const serialOptions = ref<{ label: string; value: string }[]>([{ label: '请选择串口', value: '' }])
const rawHex = ref('')
const log = ref('')

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

const latestNormalLockFrame = ref<PadParsedFrame | null>(null)
const latestNormalLockCloseFrame = ref<PadParsedFrame | null>(null)
const latestMagneticLockFrame = ref<PadParsedFrame | null>(null)
const latestMicroswitchFrame = ref<PadParsedFrame | null>(null)
const latestMagneticRawResponse = ref('')

let disposeStatusListener = () => {}
let disposeRawListener = () => {}
let disposeFrameListener = () => {}

const normalLockSummary = computed(() => {
  if (!latestNormalLockFrame.value) {
    return '暂无普通锁开锁/查询反馈'
  }
  return describePadFrame(latestNormalLockFrame.value)
})

const normalLockCloseSummary = computed(() => {
  if (!latestNormalLockCloseFrame.value) {
    return '暂无普通锁手动关锁反馈'
  }
  return describeNormalLockCloseFrame(latestNormalLockCloseFrame.value)
})

const magneticLockSummary = computed(() => {
  if (latestMagneticLockFrame.value) {
    return describePadFrame(latestMagneticLockFrame.value)
  }
  if (latestMagneticRawResponse.value) {
    return `收到原始反馈：${formatPadHex(latestMagneticRawResponse.value)}`
  }
  return '暂无电磁锁反馈'
})

const microswitchSummary = computed(() => {
  if (!latestMicroswitchFrame.value) {
    return '暂无微动开关反馈'
  }
  return describeMicroswitchFrame(latestMicroswitchFrame.value)
})

function appendLog(messageText: string) {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  log.value += `[${stamp}] ${messageText}\n`
}

function resolveError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function requireAddressValue(value: number | null, label: string) {
  if (value === null || value === undefined) {
    throw new Error(`${label}不能为空`)
  }
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
    throw new Error(`${label}必须是 0-255 的整数`)
  }
  return value
}

function requireBaudRate(value: number | null) {
  if (value === null || value === undefined) {
    throw new Error('波特率不能为空')
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('波特率必须是大于 0 的整数')
  }
  return value
}

function getTargetAddress(target: PadTargetConfig, label: string) {
  return {
    board: requireAddressValue(target.boardAddress, `${label}板地址`),
    lock: requireAddressValue(target.lockAddress, `${label}锁地址`)
  }
}

function matchesTarget(frame: PadParsedFrame, target: PadTargetConfig) {
  if (!Number.isInteger(target.boardAddress) || !Number.isInteger(target.lockAddress)) {
    return false
  }

  return frame.boardAddress === target.boardAddress && frame.lockAddress === target.lockAddress
}

function formatTargetPreview(target: PadTargetConfig) {
  try {
    const { board, lock } = getTargetAddress(target, '')
    return `板地址 0x${toPadHexByte(board, '板地址')} / 锁地址 0x${toPadHexByte(lock, '锁地址')}`
  } catch {
    return '请填写有效的板地址和锁地址'
  }
}

function resolveNormalLockCloseFeedbackText(frame: PadParsedFrame) {
  if (frame.statusHex === '00') {
    return '手动关锁反馈 / 状态位 00'
  }
  if (frame.statusHex === '11') {
    return '手动关锁反馈 / 状态位 11'
  }
  return `手动关锁反馈 / 状态位 ${frame.statusHex}`
}

function describeNormalLockCloseFrame(frame: PadParsedFrame) {
  const bccText = frame.bccValid
    ? 'BCC 通过'
    : `BCC 错误(期望 ${frame.expectedBccHex})`
  return `手动关锁反馈 板=${frame.boardAddress} 锁=${frame.lockAddress} 状态=${frame.statusHex}(${resolveNormalLockCloseFeedbackText(frame)}) ${bccText}`
}

function resolveMicroswitchText(frame: PadParsedFrame) {
  if (frame.statusHex === '11') {
    return '微动按下'
  }
  if (frame.statusHex === '00') {
    return '微动松开'
  }
  return `微动状态 ${frame.statusHex}`
}

function describeMicroswitchFrame(frame: PadParsedFrame) {
  const bccText = frame.bccValid
    ? 'BCC 通过'
    : `BCC 错误(期望 ${frame.expectedBccHex})`
  return `微动开关反馈 板=${frame.boardAddress} 锁=${frame.lockAddress} 状态=${frame.statusHex}(${resolveMicroswitchText(frame)}) ${bccText}`
}

function clearLog() {
  log.value = ''
}

async function refreshPorts() {
  serialOptions.value = [{ label: '请选择串口', value: '' }]
  try {
    const ports = await padSingleDevice.listPorts()
    ports.forEach((item: any) => {
      serialOptions.value.push({
        label: item.friendlyName || item.path,
        value: item.path
      })
    })
    appendLog('串口列表刷新成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`获取串口失败: ${messageText}`)
    message.error(messageText)
  }
}

async function connect() {
  try {
    const speed = requireBaudRate(baudRate.value)
    if (!portPath.value) {
      throw new Error('请选择串口')
    }
    await padSingleDevice.connectSerial({
      path: portPath.value,
      baudRate: speed
    })
    appendLog(`串口连接中: ${portPath.value}@${speed}`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`连接失败: ${messageText}`)
    message.error(messageText)
  }
}

async function disconnect() {
  try {
    await padSingleDevice.disconnect()
    appendLog('串口已断开')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`断开失败: ${messageText}`)
    message.error(messageText)
  }
}

async function handleOpenNormalLock() {
  try {
    const { board, lock } = getTargetAddress(normalLockTarget, '普通锁')
    const { commandHex, frame } = await openPadLock(board, lock)
    latestNormalLockFrame.value = frame
    appendLog(`普通锁 TX 开锁: ${formatPadHex(commandHex)}`)
    message.success(resolvePadFrameStatusText(frame))
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`普通锁开锁失败: ${messageText}`)
    message.error(messageText)
  }
}

async function handleQueryNormalLockStatus() {
  try {
    const { board, lock } = getTargetAddress(normalLockTarget, '普通锁')
    const { commandHex, frame } = await queryPadLockStatus(board, lock)
    latestNormalLockFrame.value = frame
    appendLog(`普通锁 TX 查询状态: ${formatPadHex(commandHex)}`)
    message.success(resolvePadFrameStatusText(frame))
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`普通锁查询状态失败: ${messageText}`)
    message.error(messageText)
  }
}

async function handleEnableMagneticHoldOpen() {
  try {
    const { board, lock } = getTargetAddress(magneticLockTarget, '电磁锁')
    const { commandHex, rawResponseHex, parsedResponse } = await enablePadLockKeepOpen(board, lock)
    const commandFrames = parsedResponse.parsedFrames.filter((frame) => frame.header === '9A')

    latestMagneticRawResponse.value = rawResponseHex
    appendLog(`电磁锁 TX 开启长通电: ${formatPadHex(commandHex)}`)

    if (commandFrames.length) {
      const latestFrame = commandFrames[commandFrames.length - 1]
      latestMagneticLockFrame.value = latestFrame
      appendLog(`电磁锁 RX 解析: ${describePadFrame(latestFrame)}`)
      message.success(resolvePadFrameStatusText(latestFrame))
      return
    }

    if (rawResponseHex) {
      appendLog(`电磁锁 RX 原始反馈: ${formatPadHex(rawResponseHex)}`)
      message.success('开启长通电指令已发送，收到原始反馈')
      return
    }

    appendLog('电磁锁 RX: 未收到可识别的专用反馈，建议再执行一次查询状态')
    message.success('开启长通电指令已发送')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`电磁锁开启长通电失败: ${messageText}`)
    message.error(messageText)
  }
}

async function handleDisableMagneticHoldOpen() {
  try {
    const { board, lock } = getTargetAddress(magneticLockTarget, '电磁锁')
    const { commandHex, rawResponseHex, parsedResponse } = await disablePadLockKeepOpen(board, lock)
    const commandFrames = parsedResponse.parsedFrames.filter((frame) => frame.header === '9B')

    latestMagneticRawResponse.value = rawResponseHex
    appendLog(`电磁锁 TX 关闭长通电: ${formatPadHex(commandHex)}`)

    if (commandFrames.length) {
      const latestFrame = commandFrames[commandFrames.length - 1]
      latestMagneticLockFrame.value = latestFrame
      appendLog(`电磁锁 RX 解析: ${describePadFrame(latestFrame)}`)
      message.success(resolvePadFrameStatusText(latestFrame))
      return
    }

    if (rawResponseHex) {
      appendLog(`电磁锁 RX 原始反馈: ${formatPadHex(rawResponseHex)}`)
      message.success('关闭长通电指令已发送，收到原始反馈')
      return
    }

    appendLog('电磁锁 RX: 未收到可识别的专用反馈，建议再执行一次查询状态')
    message.success('关闭长通电指令已发送')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`电磁锁关闭长通电失败: ${messageText}`)
    message.error(messageText)
  }
}

async function handleQueryMagneticLockStatus() {
  try {
    const { board, lock } = getTargetAddress(magneticLockTarget, '电磁锁')
    const { commandHex, frame } = await queryPadLockStatus(board, lock)
    latestMagneticLockFrame.value = frame
    appendLog(`电磁锁 TX 查询状态: ${formatPadHex(commandHex)}`)
    message.success(resolvePadFrameStatusText(frame))
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`电磁锁查询状态失败: ${messageText}`)
    message.error(messageText)
  }
}

async function handleSendRawHex() {
  try {
    const commandHex = await sendPadRawHex(rawHex.value)
    appendLog(`TX 自定义: ${formatPadHex(commandHex)}`)
    message.success('自定义 HEX 已发送')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`发送自定义 HEX 失败: ${messageText}`)
    message.error(messageText)
  }
}

function routeIncomingFrame(frame: PadParsedFrame) {
  if (frame.header === '81' && matchesTarget(frame, normalLockTarget)) {
    latestNormalLockCloseFrame.value = frame
    appendLog(`普通锁 手动关锁 RX: ${describeNormalLockCloseFrame(frame)}`)
  }

  if (frame.header === '81' && matchesTarget(frame, microswitchTarget)) {
    latestMicroswitchFrame.value = frame
    appendLog(`微动开关 RX: ${describeMicroswitchFrame(frame)}`)
  }

  if ((frame.header === '8A' || frame.header === '80') && matchesTarget(frame, normalLockTarget)) {
    latestNormalLockFrame.value = frame
    appendLog(`普通锁 RX: ${describePadFrame(frame)}`)
  }

  if ((frame.header === '80' || frame.header === '9A' || frame.header === '9B') && matchesTarget(frame, magneticLockTarget)) {
    latestMagneticLockFrame.value = frame
    appendLog(`电磁锁 RX: ${describePadFrame(frame)}`)
  }
}

onMounted(() => {
  void refreshPorts()

  disposeStatusListener = padSingleDevice.subscribeStatus((state) => {
    connected.value = state.connected
    lastError.value = state.lastError ?? ''
    if (state.portPath) {
      portPath.value = state.portPath
    }
    baudRate.value = state.baudRate
  })

  disposeRawListener = padSingleDevice.subscribeRawData((data) => {
    appendLog(`RX 原始: ${formatPadHex(data)}`)
  })

  disposeFrameListener = padSingleDevice.subscribeFrame((frame) => {
    routeIncomingFrame(frame)
  })
})

onUnmounted(() => {
  disposeStatusListener()
  disposeRawListener()
  disposeFrameListener()
})
</script>

<template>
  <div class="container">
    <a-space direction="vertical" size="large" style="width: 100%">
      <a-alert
        show-icon
        type="info"
        message="PAD 模块划分"
        description="页面按普通锁、电磁锁、微动开关三块拆开；每块单独维护板地址和锁地址。普通锁补充展示 81 手动关锁反馈，电磁锁不再显示指令预览白块。"
      />

      <a-card title="串口连接">
        <a-space direction="vertical" style="width: 100%">
          <div class="serial-port-row">
            <a-select
              v-model:value="portPath"
              :options="serialOptions"
              placeholder="选择串口"
              style="width: 100%"
            />
            <a-button @click="refreshPorts">刷新串口</a-button>
          </div>

          <a-input-number
            v-model:value="baudRate"
            :min="300"
            :step="300"
            placeholder="波特率"
            style="width: 100%"
          />

          <a-space wrap>
            <a-button type="primary" @click="connect">连接</a-button>
            <a-button danger @click="disconnect">断开</a-button>
            <a-tag :color="connected ? 'green' : 'red'">
              {{ connected ? '已连接' : '未连接' }}
            </a-tag>
          </a-space>

          <a-typography-text type="secondary">
            建议参数：RS-485 / 9600 / 8N1
          </a-typography-text>
          <a-typography-text v-if="lastError" type="danger">
            最近错误：{{ lastError }}
          </a-typography-text>
        </a-space>
      </a-card>

      <a-card title="普通锁模块">
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <a-input-number
                v-model:value="normalLockTarget.boardAddress"
                :min="0"
                :max="255"
                placeholder="普通锁板地址"
                style="width: 100%"
              />
              <a-input-number
                v-model:value="normalLockTarget.lockAddress"
                :min="0"
                :max="255"
                placeholder="普通锁锁地址"
                style="width: 100%"
              />
            </div>

            <a-typography-text type="secondary">
              {{ formatTargetPreview(normalLockTarget) }}
            </a-typography-text>

            <a-space wrap>
              <a-button type="primary" @click="handleOpenNormalLock">开锁</a-button>
              <a-button @click="handleQueryNormalLockStatus">查询状态</a-button>
            </a-space>
          </div>

          <div class="module-column">
            <div class="feedback-stack">
              <div class="feedback-block">
                <div class="feedback-title">开锁/状态查询反馈</div>
                <a-descriptions v-if="latestNormalLockFrame" :column="1" size="small" bordered>
                  <a-descriptions-item label="反馈类型">
                    {{ getPadFrameLabel(latestNormalLockFrame) }}
                  </a-descriptions-item>
                  <a-descriptions-item label="原始 HEX">
                    <code>{{ formatPadHex(latestNormalLockFrame.rawHex) }}</code>
                  </a-descriptions-item>
                  <a-descriptions-item label="状态位">
                    0x{{ latestNormalLockFrame.statusHex }} / {{ resolvePadFrameStatusText(latestNormalLockFrame) }}
                  </a-descriptions-item>
                  <a-descriptions-item label="BCC">
                    <a-tag :color="latestNormalLockFrame.bccValid ? 'green' : 'red'">
                      {{ latestNormalLockFrame.bccValid ? '通过' : `错误，应为 0x${latestNormalLockFrame.expectedBccHex}` }}
                    </a-tag>
                  </a-descriptions-item>
                </a-descriptions>
                <div v-else class="empty-block">暂无普通锁开锁/查询反馈</div>
                <a-typography-paragraph class="summary-text">
                  {{ normalLockSummary }}
                </a-typography-paragraph>
              </div>

              <div class="feedback-block">
                <div class="feedback-title">手动关锁反馈</div>
                <a-descriptions v-if="latestNormalLockCloseFrame" :column="1" size="small" bordered>
                  <a-descriptions-item label="反馈类型">
                    手动关锁反馈
                  </a-descriptions-item>
                  <a-descriptions-item label="原始 HEX">
                    <code>{{ formatPadHex(latestNormalLockCloseFrame.rawHex) }}</code>
                  </a-descriptions-item>
                  <a-descriptions-item label="状态位">
                    0x{{ latestNormalLockCloseFrame.statusHex }} / {{ resolveNormalLockCloseFeedbackText(latestNormalLockCloseFrame) }}
                  </a-descriptions-item>
                  <a-descriptions-item label="BCC">
                    <a-tag :color="latestNormalLockCloseFrame.bccValid ? 'green' : 'red'">
                      {{ latestNormalLockCloseFrame.bccValid ? '通过' : `错误，应为 0x${latestNormalLockCloseFrame.expectedBccHex}` }}
                    </a-tag>
                  </a-descriptions-item>
                </a-descriptions>
                <div v-else class="empty-block">暂无普通锁手动关锁反馈</div>
                <a-typography-paragraph class="summary-text">
                  {{ normalLockCloseSummary }}
                </a-typography-paragraph>
              </div>
            </div>
          </div>
        </div>
      </a-card>

      <a-card title="电磁锁模块">
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <a-input-number
                v-model:value="magneticLockTarget.boardAddress"
                :min="0"
                :max="255"
                placeholder="电磁锁板地址"
                style="width: 100%"
              />
              <a-input-number
                v-model:value="magneticLockTarget.lockAddress"
                :min="0"
                :max="255"
                placeholder="电磁锁锁地址"
                style="width: 100%"
              />
            </div>

            <a-typography-text type="secondary">
              {{ formatTargetPreview(magneticLockTarget) }}
            </a-typography-text>

            <a-space wrap>
              <a-button type="primary" @click="handleEnableMagneticHoldOpen">开启长通电</a-button>
              <a-button @click="handleDisableMagneticHoldOpen">关闭长通电</a-button>
              <a-button @click="handleQueryMagneticLockStatus">查询状态</a-button>
            </a-space>
          </div>

          <div class="module-column">
            <a-descriptions v-if="latestMagneticLockFrame" :column="1" size="small" bordered>
              <a-descriptions-item label="反馈类型">
                {{ getPadFrameLabel(latestMagneticLockFrame) }}
              </a-descriptions-item>
              <a-descriptions-item label="原始 HEX">
                <code>{{ formatPadHex(latestMagneticLockFrame.rawHex) }}</code>
              </a-descriptions-item>
              <a-descriptions-item label="状态位">
                0x{{ latestMagneticLockFrame.statusHex }} / {{ resolvePadFrameStatusText(latestMagneticLockFrame) }}
              </a-descriptions-item>
              <a-descriptions-item label="BCC">
                <a-tag :color="latestMagneticLockFrame.bccValid ? 'green' : 'red'">
                  {{ latestMagneticLockFrame.bccValid ? '通过' : `错误，应为 0x${latestMagneticLockFrame.expectedBccHex}` }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>
            <div v-else class="empty-block">暂无电磁锁解析反馈</div>

            <a-typography-paragraph class="summary-text">
              {{ magneticLockSummary }}
            </a-typography-paragraph>
            <a-typography-text type="secondary">
              `9A/9B` 不强行按统一长度拆包；如果没有可识别的专用反馈，建议再执行一次查询状态。
            </a-typography-text>
          </div>
        </div>
      </a-card>

      <a-card title="微动开关模块">
        <div class="module-grid">
          <div class="module-column">
            <div class="address-grid">
              <a-input-number
                v-model:value="microswitchTarget.boardAddress"
                :min="0"
                :max="255"
                placeholder="微动板地址"
                style="width: 100%"
              />
              <a-input-number
                v-model:value="microswitchTarget.lockAddress"
                :min="0"
                :max="255"
                placeholder="微动锁地址"
                style="width: 100%"
              />
            </div>

            <a-typography-text type="secondary">
              {{ formatTargetPreview(microswitchTarget) }}
            </a-typography-text>

            <a-alert
              show-icon
              type="warning"
              message="微动开关只监听 81 主动上报"
              description="这里不发送控制命令，只根据你配置的地址筛选并展示对应的微动反馈。"
            />
          </div>

          <div class="module-column">
            <a-descriptions v-if="latestMicroswitchFrame" :column="1" size="small" bordered>
              <a-descriptions-item label="反馈类型">
                {{ getPadFrameLabel(latestMicroswitchFrame) }}
              </a-descriptions-item>
              <a-descriptions-item label="原始 HEX">
                <code>{{ formatPadHex(latestMicroswitchFrame.rawHex) }}</code>
              </a-descriptions-item>
              <a-descriptions-item label="状态位">
                0x{{ latestMicroswitchFrame.statusHex }} / {{ resolveMicroswitchText(latestMicroswitchFrame) }}
              </a-descriptions-item>
              <a-descriptions-item label="BCC">
                <a-tag :color="latestMicroswitchFrame.bccValid ? 'green' : 'red'">
                  {{ latestMicroswitchFrame.bccValid ? '通过' : `错误，应为 0x${latestMicroswitchFrame.expectedBccHex}` }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>
            <div v-else class="empty-block">暂无微动开关反馈</div>

            <a-typography-paragraph class="summary-text">
              {{ microswitchSummary }}
            </a-typography-paragraph>
            <a-typography-text type="secondary">
              这里固定按微动事件展示：`11=微动按下`，`00=微动松开`。
            </a-typography-text>
          </div>
        </div>
      </a-card>

      <a-card title="自定义 HEX">
        <a-space direction="vertical" style="width: 100%">
          <a-typography-text type="secondary">
            自定义 HEX 会直接走当前串口发送，便于补测文档之外的命令。
          </a-typography-text>
          <div class="serial-port-row">
            <a-input v-model:value="rawHex" placeholder="例如：8A 01 01 11 9B" />
            <a-button @click="handleSendRawHex">发送自定义 HEX</a-button>
          </div>
        </a-space>
      </a-card>

      <a-card title="通讯日志">
        <a-space direction="vertical" style="width: 100%">
          <a-space wrap>
            <a-button danger @click="clearLog">清空日志</a-button>
          </a-space>
          <a-textarea
            :value="log"
            :rows="16"
            readonly
            class="log-textarea"
            placeholder="串口日志会显示在这里"
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

.serial-port-row {
  display: flex;
  gap: 12px;
  width: 100%;
}

.serial-port-row :deep(.ant-select),
.serial-port-row :deep(.ant-input) {
  flex: 1;
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

.feedback-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.feedback-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feedback-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
}

.address-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-text,
.log-textarea :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.empty-block {
  min-height: 156px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.45);
  background: #fafafa;
  border-radius: 8px;
}

@media (max-width: 1080px) {
  .module-grid,
  .address-grid {
    grid-template-columns: 1fr;
  }

  .serial-port-row {
    flex-direction: column;
  }
}
</style>

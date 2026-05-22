<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Notify } from 'quasar'
import { init, use, type ComposeOption, type ECharts } from 'echarts/core'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
  estimatePhaseDistanceCm,
  estimateRelativePhaseDistanceCm,
  normalizeHex,
  type LuodanInventoryMessage,
  type LuodanTagReadMessage
} from '../components/rfid/luodan/LuodanCommon'
import {
  buildPhaseInventoryFrame,
  readEPCPhaseContinuous,
  readPermanentOutputPower,
  sendRawLuodanHex,
  setAntennaPermanentOutputPower,
  setBeeperMode,
  setFixedFrequency,
  setHoppingFrequency
} from '../components/rfid/luodan/LuodanRfidHelper'
import {
  luodanDevice,
  type LuodanConnectionMode
} from '../components/rfid/luodan/LuodanDevice'
import { useLuodanRfidStore } from '../stores/luodanRfid'
import { useDeviceConnectionsStore, type DeviceConnectionProfile } from '../stores/deviceConnections'

defineOptions({ name: 'luodan-rfid-phase-demo' })

type TagRow = {
  key: string
  epc: string
  pc: string
  antennaId: number
  frequencyParameter: number
  frequencyMHz: number | null
  rssi: number
  phaseRaw: number | null
  phaseDegrees: number | null
  estimatedDistanceCm: number | null
  relativeDistanceCm: number | null
  movementText: string
  movementTone: 'positive' | 'negative' | 'neutral'
  movementDelta: number | null
  count: number
  lastSeenAt: string
  rawFrame: string
}

type ChartPoint = {
  time: string
  epc: string
  antennaId: number
  frequencyParameter: number
  frequencyMHz: number | null
  rssi: number
  movementText: string
  movementTone: 'positive' | 'negative' | 'neutral'
  movementDelta: number | null
}

type PhaseBaseline = {
  phaseRaw: number
  frequencyMHz: number
}

type DistanceChartOption = ComposeOption<
  GridComponentOption | LegendComponentOption | TooltipComponentOption | LineSeriesOption
>

const CONNECTION_MODE_OPTIONS: Array<{ label: string, value: LuodanConnectionMode }> = [
  { label: 'TCP', value: 'tcp' },
  { label: 'Serial', value: 'serial' }
]

const CHART_FILTER_OPTIONS: Array<{ label: string, value: 'all' | 'latest' }> = [
  { label: '全部频点', value: 'all' },
  { label: '当前频点', value: 'latest' }
]

const BEEPER_MODE_OPTIONS = [
  { label: '安静', value: 0 },
  { label: '盘存后响', value: 1 },
  { label: '读到标签响', value: 2 }
]

const MAX_CHART_POINTS = 200
const NEXT_ROUND_DELAY_MS = 80
const RSSI_TREND_WINDOW_SIZE = 8
const RSSI_TREND_HALF_WINDOW = 4
const RSSI_NEAR_FAR_THRESHOLD = 2

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const snapshot = luodanDevice.getSnapshot()
const luodanStore = useLuodanRfidStore()
const { config } = storeToRefs(luodanStore)
const deviceConnectionsStore = useDeviceConnectionsStore()
const { activeRfidSessionId, connectionProfiles } = storeToRefs(deviceConnectionsStore)

if (snapshot.connected) {
  luodanStore.setConfig({
    mode: snapshot.mode,
    connectionSessionId: snapshot.sessionId
  })
}

const connected = ref(snapshot.connected)
const currentMode = ref(snapshot.mode)
const lastError = ref(snapshot.lastError ?? '')
const inventoryStatus = ref('空闲')
const latestTag = ref<TagRow | null>(null)
const tagRows = ref<TagRow[]>([])
const chartPoints = ref<ChartPoint[]>([])
const chartFrequencyFilter = ref<'all' | 'latest'>('latest')
const log = ref('')
const isReading = ref(false)
const logScroller = ref<HTMLElement | null>(null)
const chartEl = ref<HTMLElement | null>(null)
const powerSubmitting = ref(false)
const powerReading = ref(false)
const beeperSubmitting = ref(false)
const frequencySubmitting = ref(false)

let stopPhaseRead: null | (() => void) = null
let nextRoundTimer: ReturnType<typeof setTimeout> | null = null
let activeReadSessionId: number | null = null
let chartInstance: ECharts | null = null
const phaseBaselines = new Map<string, PhaseBaseline>()
const rssiTrendWindows = new Map<string, number[]>()
let disposeStatusListener = () => {
}
let disposeRawListener = () => {
}

const connectionSessionOptions = computed(() =>
  getConnectionProfilesByMode(config.value.mode).map((profile) => ({
    label: formatConnectionSessionLabel(profile),
    value: profile.sessionId
  }))
)
const selectedConnectionProfile = computed(() =>
  getConnectionProfilesByMode(config.value.mode)
    .find((profile) => profile.sessionId === config.value.connectionSessionId) ?? null
)
function formatLogicalAntennaLabel(antennaId: number) {
  if (config.value.antennaCount <= 8) {
    return `天线${antennaId}`
  }

  const group = Math.floor((antennaId - 1) / 8) + 1
  const groupAntenna = ((antennaId - 1) % 8) + 1
  return `${group}组-天线${groupAntenna}`
}

const powerAntennaOptions = computed(() =>
  Array.from({ length: config.value.antennaCount }, (_, index) => ({
    label: formatLogicalAntennaLabel(index + 1),
    value: index + 1
  }))
)
const formattedPowerLevels = computed(() =>
  config.value.powerLevels
    .map((power, index) => `${formatLogicalAntennaLabel(index + 1)}=${power} dBm`)
    .join(', ')
)
const connectionSessionHint = computed(() => {
  const profile = selectedConnectionProfile.value
  if (!profile) {
    return config.value.mode === 'serial'
      ? '当前未配置 Serial 会话，请先在项目设置里新增串口连接。'
      : '当前未配置 TCP 会话，请先在项目设置里新增 TCP 连接。'
  }

  return `当前会话：${formatConnectionSessionLabel(profile)}`
})
const previewFrame = computed(() => {
  try {
    return buildPhaseInventoryFrame({
      session: config.value.inventorySession,
      target: config.value.target,
      sl: config.value.sl,
      repeat: config.value.repeat,
      address: config.value.readerAddress
    })
  } catch {
    return ''
  }
})
const visibleChartPoints = computed(() => {
  if (chartFrequencyFilter.value !== 'latest') {
    return chartPoints.value
  }

  const frequencyParameter = latestTag.value?.frequencyParameter
  if (frequencyParameter === undefined) {
    return chartPoints.value
  }

  return chartPoints.value.filter((point) => point.frequencyParameter === frequencyParameter)
})

function notify(type: 'positive' | 'negative', content: unknown) {
  Notify.create({
    type,
    message: String(content ?? ''),
    position: 'top',
    timeout: 2200
  })
}

function appendLog(messageText: string) {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  log.value += `[${stamp}] ${messageText}\n`
  void nextTick(() => {
    if (!logScroller.value) return
    logScroller.value.scrollTop = logScroller.value.scrollHeight
  })
}

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

function requireSessionId(value: unknown, label = '连接会话 ID') {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label}必须是大于等于 0 的整数`)
  }
  return parsed
}

function formatConnectionModeLabel(mode: LuodanConnectionMode) {
  return mode === 'serial' ? 'Serial' : 'TCP'
}

function formatConnectionSessionLabel(profile: DeviceConnectionProfile) {
  return `${profile.name} / Session ${profile.sessionId}`
}

function formatPowerLevels(powerLevels: number[]) {
  return powerLevels.map((power, index) => `${formatLogicalAntennaLabel(index + 1)}=${power} dBm`).join(', ')
}

function getConnectionProfilesByMode(mode: LuodanConnectionMode) {
  return connectionProfiles.value
    .filter((profile) => profile.mode === mode)
    .sort((left, right) => left.sessionId - right.sessionId)
}

function resolveSessionIdForMode(mode: LuodanConnectionMode, preferredSessionId?: unknown) {
  const profiles = getConnectionProfilesByMode(mode)
  const normalizedPreferredSessionId = normalizeSessionId(preferredSessionId)

  return profiles.find((profile) => profile.sessionId === normalizedPreferredSessionId)?.sessionId
    ?? profiles[0]?.sessionId
    ?? 0
}

function syncConnectionSnapshot(mode: LuodanConnectionMode, sessionId: number) {
  luodanDevice.setActiveSession(sessionId)
  luodanDevice.setMode(mode, sessionId)
  const snapshot = luodanDevice.getSnapshot(sessionId)
  connected.value = snapshot.connected
  currentMode.value = snapshot.mode
  lastError.value = snapshot.lastError ?? ''
}

function handleConnectionModeChange(mode: LuodanConnectionMode) {
  luodanStore.setConfig({
    mode,
    connectionSessionId: resolveSessionIdForMode(mode, config.value.connectionSessionId)
  })
}

function handleConnectionSessionChange(sessionId: number | null) {
  if (typeof sessionId !== 'number') {
    return
  }

  luodanStore.setConfig({
    mode: config.value.mode,
    connectionSessionId: resolveSessionIdForMode(config.value.mode, sessionId)
  })
}

function formatDistanceCm(value: number | null) {
  return value === null ? '-' : value.toFixed(2)
}

function formatDistanceCmWithUnit(value: number | null) {
  return value === null ? '-' : `${formatDistanceCm(value)} cm`
}

function formatFrequencyMHz(value: number | null) {
  return value === null ? '-' : value.toFixed(2)
}

function createPhaseBaselineKey(tag: LuodanTagReadMessage) {
  return `${tag.epc}-${tag.antennaId}-${tag.frequencyParameter}`
}

function createMovementKey(tag: LuodanTagReadMessage) {
  return `${tag.epc}-${tag.antennaId}`
}

function average(values: number[]) {
  if (!values.length) {
    return 0
  }

  return values.reduce((total, value) => total + value, 0) / values.length
}

function updateMovementTrend(tag: LuodanTagReadMessage) {
  const key = createMovementKey(tag)
  const samples = [...(rssiTrendWindows.get(key) ?? []), tag.rssi.value]
    .slice(-RSSI_TREND_WINDOW_SIZE)
  rssiTrendWindows.set(key, samples)

  if (samples.length < RSSI_TREND_WINDOW_SIZE) {
    return {
      movementText: '观察中',
      movementTone: 'neutral' as const,
      movementDelta: null
    }
  }

  const previousAverage = average(samples.slice(0, RSSI_TREND_HALF_WINDOW))
  const currentAverage = average(samples.slice(RSSI_TREND_HALF_WINDOW))
  const delta = currentAverage - previousAverage

  if (delta >= RSSI_NEAR_FAR_THRESHOLD) {
    return {
      movementText: '靠近',
      movementTone: 'positive' as const,
      movementDelta: delta
    }
  }

  if (delta <= -RSSI_NEAR_FAR_THRESHOLD) {
    return {
      movementText: '远离',
      movementTone: 'negative' as const,
      movementDelta: delta
    }
  }

  return {
    movementText: '稳定',
    movementTone: 'neutral' as const,
    movementDelta: delta
  }
}

function formatMovementDelta(value: number | null) {
  if (value === null) {
    return '-'
  }

  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
}

function createTagRow(tag: LuodanTagReadMessage): TagRow {
  const phaseRaw = tag.phase?.raw ?? null
  const frequencyMHz = tag.frequencyMHz ?? config.value.carrierFrequencyMHz
  const estimatedDistanceCm = phaseRaw === null
    ? null
    : estimatePhaseDistanceCm(phaseRaw, frequencyMHz)
  const baselineKey = createPhaseBaselineKey(tag)
  const baseline = phaseBaselines.get(baselineKey)
  if (!baseline && phaseRaw !== null) {
    phaseBaselines.set(baselineKey, { phaseRaw, frequencyMHz })
  }
  const effectiveBaseline = baseline ?? phaseBaselines.get(baselineKey)
  const movement = updateMovementTrend(tag)

  return {
    key: `${tag.epc}-${tag.antennaId}`,
    epc: tag.epc,
    pc: tag.pc,
    antennaId: tag.antennaId,
    frequencyParameter: tag.frequencyParameter,
    frequencyMHz: tag.frequencyMHz,
    rssi: tag.rssi.value,
    phaseRaw,
    phaseDegrees: tag.phase?.degrees ?? null,
    estimatedDistanceCm,
    relativeDistanceCm:
      phaseRaw === null || !effectiveBaseline
        ? null
        : estimateRelativePhaseDistanceCm(phaseRaw, effectiveBaseline.phaseRaw, effectiveBaseline.frequencyMHz),
    movementText: movement.movementText,
    movementTone: movement.movementTone,
    movementDelta: movement.movementDelta,
    count: 1,
    lastSeenAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    rawFrame: tag.rawFrame
  }
}

function appendChartPoint(row: TagRow) {
  const point: ChartPoint = {
    time: row.lastSeenAt,
    epc: row.epc,
    antennaId: row.antennaId,
    frequencyParameter: row.frequencyParameter,
    frequencyMHz: row.frequencyMHz,
    rssi: row.rssi,
    movementText: row.movementText,
    movementTone: row.movementTone,
    movementDelta: row.movementDelta
  }

  chartPoints.value = [...chartPoints.value, point].slice(-MAX_CHART_POINTS)
}

function upsertTag(tag: LuodanTagReadMessage) {
  const nextRow = createTagRow(tag)
  const index = tagRows.value.findIndex((row) => row.key === nextRow.key)

  if (index === -1) {
    tagRows.value = [nextRow, ...tagRows.value].slice(0, 50)
    latestTag.value = nextRow
    appendChartPoint(nextRow)
    return
  }

  const previous = tagRows.value[index]
  const merged = {
    ...nextRow,
    count: previous.count + 1
  }
  tagRows.value.splice(index, 1)
  tagRows.value.unshift(merged)
  latestTag.value = merged
  appendChartPoint(merged)
}

function clearNextRoundTimer() {
  if (nextRoundTimer === null) {
    return
  }

  clearTimeout(nextRoundTimer)
  nextRoundTimer = null
}

function scheduleNextReadRound() {
  clearNextRoundTimer()
  if (!isReading.value || activeReadSessionId === null) {
    return
  }

  nextRoundTimer = setTimeout(() => {
    if (!isReading.value || activeReadSessionId === null) {
      return
    }

    try {
      sendRawLuodanHex(previewFrame.value, activeReadSessionId)
      appendLog(`会话[${activeReadSessionId}]继续 EPC 相位读取: ${previewFrame.value}`)
    } catch (error) {
      const messageText = resolveError(error)
      appendLog(`连续读取发送失败: ${messageText}`)
      notify('negative', messageText)
      stopInventory()
    }
  }, NEXT_ROUND_DELAY_MS)
}

function handleInventoryMessage(message: LuodanInventoryMessage) {
  if (message.type === 'tag') {
    upsertTag(message.tag)
    appendLog(
      `标签 EPC=${message.tag.epc} 天线=${message.tag.antennaId} RSSI=${message.tag.rssi.value} 频点=${message.tag.frequencyParameter} 频率=${formatFrequencyMHz(message.tag.frequencyMHz)}MHz Phase=${message.tag.phase?.raw ?? '-'}`
    )
    return
  }

  if (message.type === 'done') {
    inventoryStatus.value = `本轮完成，总读取 ${message.totalRead}`
    appendLog(`盘存完成: 天线=${message.antennaId} 速率=${message.readRate} 总数=${message.totalRead}`)
    scheduleNextReadRound()
    return
  }

  appendLog(`盘存错误: ${message.message}`)
  notify('negative', message.message)
  stopInventory()
}

function startPhaseRead() {
  try {
    const connectionSessionId = requireSessionId(config.value.connectionSessionId)
    stopPhaseRead?.()
    clearNextRoundTimer()
    isReading.value = true
    activeReadSessionId = connectionSessionId
    stopPhaseRead = readEPCPhaseContinuous(handleInventoryMessage, {
      session: config.value.inventorySession,
      target: config.value.target,
      sl: config.value.sl,
      repeat: config.value.repeat,
      address: config.value.readerAddress,
      sessionId: connectionSessionId
    }) ?? null
    inventoryStatus.value = '连续相位读取中'
    appendLog(`会话[${connectionSessionId}]开始连续 EPC 相位读取: ${previewFrame.value}`)
  } catch (error) {
    isReading.value = false
    activeReadSessionId = null
    const messageText = resolveError(error)
    inventoryStatus.value = '读取失败'
    appendLog(`相位读取失败: ${messageText}`)
    notify('negative', messageText)
  }
}

function stopInventory() {
  isReading.value = false
  activeReadSessionId = null
  clearNextRoundTimer()
  stopPhaseRead?.()
  stopPhaseRead = null
  inventoryStatus.value = '已停止'
  appendLog('已停止本页面连续相位读取')
}

function sendRawHex() {
  try {
    const connectionSessionId = requireSessionId(config.value.connectionSessionId)
    const payload = normalizeHex(config.value.rawHex)
    if (!payload) {
      throw new Error('请输入待发送的 HEX')
    }
    sendRawLuodanHex(payload, connectionSessionId)
    appendLog(`会话[${connectionSessionId}]TX: ${payload}`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`发送失败: ${messageText}`)
    notify('negative', messageText)
  }
}

async function applyPermanentPower() {
  try {
    const connectionSessionId = requireSessionId(config.value.connectionSessionId)
    powerSubmitting.value = true
    const currentPowerLevels = await readPermanentOutputPower({
      address: config.value.readerAddress,
      sessionId: connectionSessionId,
      antennaCount: config.value.antennaCount
    })
    const result = await setAntennaPermanentOutputPower({
      antennaId: config.value.powerAntennaId,
      powerDbm: config.value.permanentPowerDbm,
      currentPowerLevels: currentPowerLevels.length ? currentPowerLevels : config.value.powerLevels,
      antennaCount: config.value.antennaCount,
      address: config.value.readerAddress,
      sessionId: connectionSessionId
    })
    luodanStore.setConfig({
      antennaCount: Math.min(Math.max(result.powerLevels.length, 1), 16),
      powerLevels: result.powerLevels
    })
    appendLog(
      `会话[${connectionSessionId}]永久功率写入成功: ${formatLogicalAntennaLabel(config.value.powerAntennaId)}=${config.value.permanentPowerDbm} dBm, 组=${result.groupIndex + 1}, TX=${result.frame}`
    )
    notify('positive', '永久功率写入成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`永久功率写入失败: ${messageText}`)
    notify('negative', messageText)
  } finally {
    powerSubmitting.value = false
  }
}

async function loadPermanentPower() {
  try {
    const connectionSessionId = requireSessionId(config.value.connectionSessionId)
    powerReading.value = true
    const powerLevels = await readPermanentOutputPower({
      address: config.value.readerAddress,
      sessionId: connectionSessionId,
      antennaCount: config.value.antennaCount
    })
    if (powerLevels.length) {
      luodanStore.setConfig({
        antennaCount: Math.min(Math.max(powerLevels.length, 1), 16),
        powerLevels,
        permanentPowerDbm: powerLevels[config.value.powerAntennaId - 1] ?? config.value.permanentPowerDbm
      })
    }
    appendLog(
      `会话[${connectionSessionId}]读取永久功率成功: ${powerLevels.length ? formatPowerLevels(powerLevels) : '无数据'}`
    )
    notify('positive', '读取永久功率成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`读取永久功率失败: ${messageText}`)
    notify('negative', messageText)
  } finally {
    powerReading.value = false
  }
}

async function applyBeeperMode() {
  try {
    const connectionSessionId = requireSessionId(config.value.connectionSessionId)
    beeperSubmitting.value = true
    const frame = await setBeeperMode(config.value.beeperMode, {
      address: config.value.readerAddress,
      sessionId: connectionSessionId
    })
    appendLog(`会话[${connectionSessionId}]蜂鸣器设置成功: 模式=${config.value.beeperMode}, TX=${frame}`)
    notify('positive', '蜂鸣器设置成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`蜂鸣器设置失败: ${messageText}`)
    notify('negative', messageText)
  } finally {
    beeperSubmitting.value = false
  }
}

async function applyFixedFrequency() {
  try {
    const connectionSessionId = requireSessionId(config.value.connectionSessionId)
    frequencySubmitting.value = true
    const frame = await setFixedFrequency(config.value.carrierFrequencyMHz, {
      address: config.value.readerAddress,
      sessionId: connectionSessionId
    })
    appendLog(`会话[${connectionSessionId}]设置定频成功: ${config.value.carrierFrequencyMHz} MHz, TX=${frame}`)
    notify('positive', '定频设置成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`设置定频失败: ${messageText}`)
    notify('negative', messageText)
  } finally {
    frequencySubmitting.value = false
  }
}

async function applyHoppingFrequency() {
  try {
    const connectionSessionId = requireSessionId(config.value.connectionSessionId)
    frequencySubmitting.value = true
    const frame = await setHoppingFrequency({
      address: config.value.readerAddress,
      sessionId: connectionSessionId
    })
    appendLog(`会话[${connectionSessionId}]设置变频成功: CHN 913.5~928 MHz, TX=${frame}`)
    notify('positive', '变频设置成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`设置变频失败: ${messageText}`)
    notify('negative', messageText)
  } finally {
    frequencySubmitting.value = false
  }
}

function closeBeeper() {
  config.value.beeperMode = 0
  void applyBeeperMode()
}

function clearTags() {
  tagRows.value = []
  latestTag.value = null
  chartPoints.value = []
  phaseBaselines.clear()
  rssiTrendWindows.clear()
}

function clearLog() {
  log.value = ''
}

function buildChartOption(): DistanceChartOption {
  return {
    animation: false,
    color: ['#2563eb', '#16a34a'],
    grid: {
      top: 42,
      right: 18,
      bottom: 44,
      left: 52
    },
    legend: {
      top: 0,
      right: 0
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params
        const index = Number(item?.dataIndex ?? -1)
        const points = visibleChartPoints.value
        const point = points[index]
        if (!point) {
          return ''
        }
        return [
          point.time,
          `EPC: ${point.epc}`,
          `天线: ${point.antennaId}`,
          `RSSI: ${point.rssi}`,
          `变化: ${point.movementText}`,
          `RSSI变化: ${formatMovementDelta(point.movementDelta)}`,
          `频率: ${formatFrequencyMHz(point.frequencyMHz)} MHz`
        ].join('<br/>')
      }
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: visibleChartPoints.value.map((point) => point.time),
      axisLabel: {
        hideOverlap: true
      }
    },
    yAxis: {
      type: 'value',
      name: 'RSSI',
      scale: true,
      splitLine: {
        lineStyle: {
          color: 'rgba(148, 163, 184, 0.22)'
        }
      }
    },
    series: [
      {
        name: 'RSSI轨迹',
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 8,
        data: visibleChartPoints.value.map((point) => ({
          value: point.rssi,
          itemStyle: {
            color: point.movementTone === 'positive'
              ? '#16a34a'
              : point.movementTone === 'negative'
                ? '#dc2626'
                : '#64748b'
          }
        })),
        lineStyle: {
          width: 2
        }
      }
    ]
  }
}

function renderChart() {
  if (!chartInstance) {
    return
  }

  chartInstance.setOption(buildChartOption(), true)
}

function ensureChart() {
  if (chartInstance || !chartEl.value) {
    return
  }

  chartInstance = init(chartEl.value)
  renderChart()
}

function resizeChart() {
  chartInstance?.resize()
}

watch(
  [() => config.value.mode, () => config.value.connectionSessionId, connectionProfiles],
  ([nextMode, nextSessionId]) => {
    const resolvedSessionId = resolveSessionIdForMode(nextMode, nextSessionId)
    if (resolvedSessionId !== nextSessionId) {
      luodanStore.setConfig({ connectionSessionId: resolvedSessionId })
      return
    }

    const sessionId = requireSessionId(resolvedSessionId)
    if (activeRfidSessionId.value !== sessionId) {
      deviceConnectionsStore.setActiveRfidSession(sessionId)
    }

    syncConnectionSnapshot(nextMode, sessionId)
  },
  { deep: true, immediate: true }
)

watch(activeRfidSessionId, (nextSessionId) => {
  if (config.value.connectionSessionId === nextSessionId) {
    return
  }

  const profile = deviceConnectionsStore.getProfileBySessionId(nextSessionId)
  luodanStore.setConfig({
    connectionSessionId: nextSessionId,
    mode: profile?.mode ?? config.value.mode
  })
}, { immediate: true })

onMounted(() => {
  const sessionId = requireSessionId(config.value.connectionSessionId)
  syncConnectionSnapshot(config.value.mode, sessionId)
  void nextTick(() => {
    ensureChart()
  })
  window.addEventListener('resize', resizeChart)

  disposeStatusListener = luodanDevice.subscribeStatus((state) => {
    if (state.sessionId !== config.value.connectionSessionId) {
      return
    }
    connected.value = state.connected
    currentMode.value = state.mode
    lastError.value = state.lastError ?? ''
  })

  disposeRawListener = luodanDevice.subscribeRawData((sessionId, source, data) => {
    if (sessionId !== config.value.connectionSessionId || source !== config.value.mode) return
    appendLog(`会话[${sessionId}] ${source.toUpperCase()} RX: ${data}`)
  })
})

onUnmounted(() => {
  isReading.value = false
  clearNextRoundTimer()
  stopPhaseRead?.()
  chartInstance?.dispose()
  chartInstance = null
  window.removeEventListener('resize', resizeChart)
  disposeStatusListener()
  disposeRawListener()
})

watch([chartPoints, chartFrequencyFilter, () => latestTag.value?.frequencyParameter], () => {
  renderChart()
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
              :model-value="config.mode"
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
            <div class="panel-title">0x8B 相位盘存参数</div>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <div class="param-grid">
              <q-input v-model.number="config.readerAddress" outlined type="number" min="0" max="255" label="读写器地址" />
              <q-input v-model.number="config.antennaCount" outlined type="number" min="1" max="16" label="天线数" />
              <q-input v-model.number="config.inventorySession" outlined type="number" min="0" max="3" label="Session" />
              <q-input v-model.number="config.target" outlined type="number" min="0" max="1" label="Target" />
              <q-input v-model.number="config.sl" outlined type="number" min="0" max="3" label="SL" />
              <q-input v-model.number="config.repeat" outlined type="number" min="0" max="255" label="Repeat" />
              <q-input v-model.number="config.carrierFrequencyMHz" outlined type="number" min="1" label="兜底频率 MHz" />
            </div>
            <div class="info-panel">
              <div class="info-panel__title">频率设置</div>
              <div class="action-buttons">
                <q-btn
                  color="primary"
                  no-caps
                  unelevated
                  :loading="frequencySubmitting"
                  @click="applyFixedFrequency"
                >
                  改为定频 {{ config.carrierFrequencyMHz }} MHz
                </q-btn>
                <q-btn
                  outline
                  color="primary"
                  no-caps
                  :loading="frequencySubmitting"
                  @click="applyHoppingFrequency"
                >
                  改为变频
                </q-btn>
              </div>
              <div class="muted-text power-levels-text">
                定频使用 0x78 自定义频谱，频点数量为 1；变频使用 CHN 默认频点 913.5~928 MHz。设置后建议清空标签再重新读取。
              </div>
            </div>
            <div class="info-panel">
              <div class="info-panel__title">永久天线功率</div>
              <div class="param-grid power-param-grid">
                <q-select
                  v-model="config.powerAntennaId"
                  outlined
                  emit-value
                  map-options
                  :options="powerAntennaOptions"
                  label="指定天线"
                />
                <q-input
                  v-model.number="config.permanentPowerDbm"
                  outlined
                  type="number"
                  min="0"
                  max="33"
                  suffix="dBm"
                  label="功率"
                />
                <div class="action-buttons power-actions">
                  <q-btn
                    color="primary"
                    no-caps
                    unelevated
                    :loading="powerSubmitting"
                    @click="applyPermanentPower"
                  >
                    永久写入
                  </q-btn>
                  <q-btn
                    outline
                    color="primary"
                    no-caps
                    :loading="powerReading"
                    @click="loadPermanentPower"
                  >
                    读取功率
                  </q-btn>
                </div>
              </div>
              <div class="muted-text power-levels-text">
                当前保存：{{ formattedPowerLevels || '-' }}。16口设备按两组 1-8 自动切组；永久写入使用 0x76，成功后保存到读写器 Flash，断电不丢。
              </div>
            </div>
            <div class="info-panel">
              <div class="info-panel__title">蜂鸣器</div>
              <div class="param-grid power-param-grid">
                <q-select
                  v-model="config.beeperMode"
                  outlined
                  emit-value
                  map-options
                  :options="BEEPER_MODE_OPTIONS"
                  label="蜂鸣器模式"
                />
                <div class="action-buttons power-actions">
                  <q-btn
                    color="primary"
                    no-caps
                    unelevated
                    :loading="beeperSubmitting"
                    @click="applyBeeperMode"
                  >
                    保存蜂鸣器
                  </q-btn>
                  <q-btn
                    outline
                    color="primary"
                    no-caps
                    :loading="beeperSubmitting"
                    @click="closeBeeper"
                  >
                    关闭蜂鸣器
                  </q-btn>
                </div>
              </div>
              <div class="muted-text power-levels-text">安静模式使用 0x7A 00，成功后保存到读写器 Flash。</div>
            </div>
            <div class="info-panel">
              <div class="info-panel__title">发送帧预览</div>
              <code class="breakable-code">{{ previewFrame || '-' }}</code>
            </div>
            <div class="muted-text">Phase=01 固定开启；优先按回调 FreqAnt 高 6 位映射的实际频点计算，兜底频率只在频点异常时使用。距离为半波长内相位等效值，未做现场标定。</div>
          </q-card-section>
        </q-card>
      </div>

      <div class="layout-row layout-row-bottom">
        <q-card flat bordered class="panel-card panel-card-wide">
          <q-card-section class="panel-title-row">
            <div class="panel-title">EPC 相位标签</div>
            <q-chip square dense color="primary" text-color="white">{{ inventoryStatus }}</q-chip>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <div class="action-buttons">
              <q-btn color="primary" no-caps unelevated @click="startPhaseRead">开始读取</q-btn>
              <q-btn color="negative" no-caps unelevated @click="stopInventory">停止监听</q-btn>
              <q-btn outline color="primary" no-caps @click="clearTags">清空标签</q-btn>
            </div>

            <div v-if="latestTag" class="info-panel">
              <div class="info-panel__title">最近标签</div>
              <div class="info-list">
                <div class="movement-result" :class="`movement-result--${latestTag.movementTone}`">
                  {{ latestTag.movementText }}
                </div>
                <div class="info-row"><span>EPC</span><code>{{ latestTag.epc }}</code></div>
                <div class="info-row"><span>天线</span><strong>{{ latestTag.antennaId }}</strong></div>
                <div class="info-row"><span>RSSI</span><strong>{{ latestTag.rssi }}</strong></div>
                <div class="info-row"><span>变化</span><strong>{{ formatMovementDelta(latestTag.movementDelta) }}</strong></div>
              </div>
            </div>

            <div class="info-panel">
              <div class="chart-title-row">
                <div class="info-panel__title">相位等效距离趋势</div>
                <q-btn-toggle
                  v-model="chartFrequencyFilter"
                  dense
                  no-caps
                  unelevated
                  toggle-color="primary"
                  :options="CHART_FILTER_OPTIONS"
                />
              </div>
              <div ref="chartEl" class="distance-chart" />
            </div>

            <q-table
              flat
              bordered
              dense
              row-key="key"
              :rows="tagRows"
              :pagination="{ rowsPerPage: 10 }"
              :columns="[
                { name: 'epc', label: 'EPC', field: 'epc', align: 'left' },
                { name: 'movementText', label: '变化', field: 'movementText', align: 'center' },
                { name: 'antennaId', label: '天线', field: 'antennaId', align: 'center' },
                { name: 'rssi', label: 'RSSI', field: 'rssi', align: 'center' },
                { name: 'movementDelta', label: 'RSSI变化', field: 'movementDelta', align: 'center' },
                { name: 'count', label: '次数', field: 'count', align: 'center' },
                { name: 'lastSeenAt', label: '最近时间', field: 'lastSeenAt', align: 'center' }
              ]"
            >
              <template #body-cell-movementText="props">
                <q-td :props="props">
                  <q-chip
                    square
                    dense
                    :color="props.row.movementTone === 'positive' ? 'positive' : props.row.movementTone === 'negative' ? 'negative' : 'grey'"
                    text-color="white"
                  >
                    {{ props.row.movementText }}
                  </q-chip>
                </q-td>
              </template>
              <template #body-cell-movementDelta="props">
                <q-td :props="props">
                  {{ formatMovementDelta(props.row.movementDelta) }}
                </q-td>
              </template>
            </q-table>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="panel-card">
          <q-card-section>
            <div class="panel-title">原始 HEX 调试</div>
          </q-card-section>
          <q-separator />
          <q-card-section class="panel-stack">
            <q-input
              v-model="config.rawHex"
              outlined
              label="原始 HEX"
              placeholder="输入 luodan 原始 HEX 帧"
            />
            <div class="action-buttons">
              <q-btn outline color="primary" no-caps @click="sendRawHex">发送 HEX</q-btn>
              <q-btn color="negative" no-caps unelevated @click="clearLog">清空日志</q-btn>
            </div>
            <div ref="logScroller" class="log-panel" role="log" aria-label="收发日志">
              <pre>{{ log || '收发日志' }}</pre>
            </div>
          </q-card-section>
        </q-card>
      </div>
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

.layout-row {
  display: grid;
  gap: 16px;
  align-items: stretch;
}

.layout-row-top {
  grid-template-columns: minmax(320px, 0.8fr) minmax(0, 1.2fr);
}

.layout-row-bottom {
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.8fr);
}

.panel-card {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 8px;
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

.param-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.power-actions {
  align-items: center;
}

.power-levels-text {
  margin-top: 10px;
}

.muted-text {
  color: var(--app-text-secondary);
}

.error-banner {
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.14);
  color: rgb(185, 28, 28);
}

.info-panel {
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px;
}

.info-panel__title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.chart-title-row {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.chart-title-row .info-panel__title {
  margin-bottom: 0;
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

.breakable-code {
  display: block;
  overflow-wrap: anywhere;
  white-space: normal;
}

.breakable-code,
.log-panel pre {
  font-family: 'SFMono-Regular', 'Monaco', 'Consolas', monospace;
}

.distance-chart {
  height: 280px;
  min-height: 280px;
  width: 100%;
}

.log-panel {
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  color: var(--app-text-primary);
  height: 260px;
  overflow-y: auto;
  padding: 12px;
}

.log-panel pre {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

@media (max-width: 1100px) {
  .layout-row-top,
  .layout-row-bottom {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 700px) {
  .param-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .panel-title-row,
  .action-buttons {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

<script setup lang="ts">
import {storeToRefs} from 'pinia'
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {message} from 'ant-design-vue'
import {guoxinSingleDevice, type GuoxinConnectionMode} from '../components/rfid/guoxin/GuoXinSingleDevice'
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

defineOptions({name: 'guoxin-rfid-demo'})

type ModeOption = {
  label: string
  value: GuoxinConnectionMode
}

const snapshot = guoxinSingleDevice.getSnapshot()

const modeOptions: ModeOption[] = [
  {label: 'RS232', value: 'serial'},
  {label: 'TCP', value: 'tcp'}
]

const rfidStore = useGuoxinRfidStore()
const {config: rfidConfig} = storeToRefs(rfidStore)

if (snapshot.connected) {
  rfidStore.setConfig({
    mode: snapshot.mode,
    antennaCount: snapshot.antNum
  })
}

const connected = ref(snapshot.connected)
const lastError = ref(snapshot.lastError ?? '')
const serialOptions = ref<{ label: string; value: string }[]>([{label: '请选择串口', value: ''}])
const inventoryStatus = ref('空闲')
const latestTag = ref<IRFIDTagReadMessage | null>(null)
const log = ref('')
const powerModalVisible = ref(false)
const powerSubmitting = ref(false)
const powerEditor = ref<number[]>([])

let stopContinuousRead: null | (() => void) = null
let disposeStatusListener = () => {
}
let disposeRawListener = () => {
}

const isSerial = computed(() => rfidConfig.value.mode === 'serial')
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

function appendLog(messageText: string) {
  const stamp = new Date().toLocaleTimeString('zh-CN', {hour12: false})
  log.value += `[${stamp}] ${messageText}\n`
}

function formatPowerLevels(powerLevels: number[]) {
  return powerLevels.map((power, index) => `天线${index + 1}=${power}`).join(', ')
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
  guoxinSingleDevice.setAntNum(rfidConfig.value.antennaCount)
}

function handleTagData(data: IRFIDTagReadMessage | null) {
  if (!data) return
  latestTag.value = data
  appendLog(`标签 EPC=${data.epc} 天线=${data.antennaId} RSSI=${data.rssi?.value ?? '-'}`)
}

async function refreshPorts() {
  serialOptions.value = [{label: '请选择串口', value: ''}]
  try {
    const ports = await window.serial.list()
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
    syncDeviceAntNum()
    guoxinSingleDevice.setMode(rfidConfig.value.mode)

    if (isSerial.value) {
      if (!rfidConfig.value.portPath) {
        throw new Error('请选择串口')
      }
      await guoxinSingleDevice.connectSerial({
        path: rfidConfig.value.portPath,
        baudRate: rfidConfig.value.baudRate
      })
      appendLog(`RS232 连接中: ${rfidConfig.value.portPath}@${rfidConfig.value.baudRate}`)
      return
    }

    if (!rfidConfig.value.host || !rfidConfig.value.tcpPort) {
      throw new Error('请填写 TCP 地址与端口')
    }

    await guoxinSingleDevice.connectTcp({
      host: rfidConfig.value.host,
      port: rfidConfig.value.tcpPort
    })
    appendLog(`TCP 连接中: ${rfidConfig.value.host}:${rfidConfig.value.tcpPort}`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`连接失败: ${messageText}`)
    message.error(messageText)
  }
}

async function disconnect() {
  try {
    stopContinuousRead?.()
    stopContinuousRead = null
    await guoxinSingleDevice.disconnect(rfidConfig.value.mode)
    inventoryStatus.value = '空闲'
    appendLog('连接已断开')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`断开失败: ${messageText}`)
    message.error(messageText)
  }
}

async function startSingleRead() {
  try {
    syncDeviceAntNum()
    inventoryStatus.value = '单次读取中'
    const antennas = parseAntennas(rfidConfig.value.antsInput, rfidConfig.value.antennaCount)
    const reason = await readEPC(antennas, handleTagData)
    inventoryStatus.value = reason ?? '单次读取完成'
    appendLog(`单次读取结束: ${inventoryStatus.value}`)
  } catch (error) {
    const messageText = resolveError(error)
    inventoryStatus.value = '读取失败'
    appendLog(`单次读取失败: ${messageText}`)
    message.error(messageText)
  }
}

function startContinuousRead() {
  try {
    syncDeviceAntNum()
    stopContinuousRead?.()
    const antennas = parseAntennas(rfidConfig.value.antsInput, rfidConfig.value.antennaCount)
    stopContinuousRead = readEPCContinuous(antennas, handleTagData) ?? null
    inventoryStatus.value = '连续读取中'
    appendLog(`开始连续读取: 天线 ${antennas.join(',')}`)
  } catch (error) {
    const messageText = resolveError(error)
    inventoryStatus.value = '读取失败'
    appendLog(`连续读取失败: ${messageText}`)
    message.error(messageText)
  }
}

async function stopInventory() {
  try {
    await stopReadEPC()
    stopContinuousRead?.()
    stopContinuousRead = null
    inventoryStatus.value = '已停止'
    appendLog('停止盘存成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`停止读取失败: ${messageText}`)
    message.error(messageText)
  }
}

async function prepareWriteMode() {
  if (inventoryStatus.value !== '空闲' || stopContinuousRead) {
    try {
      await stopReadEPC()
      appendLog('写标签前已停止盘存')
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
    message.error('还没有可用的标签数据')
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

async function firstWriteTag() {
  try {
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
      onProgress: appendLog
    })
    rfidStore.setConfig({oldAccessPassword: payload.accessPassword})
    appendLog('首次写入完成')
    message.success('首次写入完成')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`首次写入失败: ${messageText}`)
    message.error(messageText)
  }
}

async function rewriteTag() {
  try {
    syncDeviceAntNum()
    await prepareWriteMode()
    const payload = buildWritePayload()
    await writeEPC(
        [payload.antenna],
        payload.epc,
        payload.tid,
        payload.accessPassword
    )
    appendLog('再次写入成功')
    message.success('再次写入成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`再次写入失败: ${messageText}`)
    message.error(messageText)
  }
}

async function applyPowerConfig() {
  try {
    powerSubmitting.value = true
    syncDeviceAntNum()
    const powerLevels = [...powerEditor.value]
    rfidStore.setConfig({powerLevels})
    await configPower(powerLevels)
    appendLog(`设置功率完成: ${formatPowerLevels(powerLevels)}`)
    powerModalVisible.value = false
    message.success('功率配置成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`设置功率失败: ${messageText}`)
    message.error(messageText)
  } finally {
    powerSubmitting.value = false
  }
}

async function loadAllPower() {
  try {
    const powerLevels = await readAllAntOutputPower()
    if (powerLevels.length) {
      rfidStore.setConfig({
        antennaCount: powerLevels.length,
        powerLevels
      })
    }
    appendLog(`读取功率成功: ${powerLevels.length ? formatPowerLevels(powerLevels) : '无数据'}`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`读取功率失败: ${messageText}`)
    message.error(messageText)
  }
}

async function applyBasebandConfig() {
  try {
    await configEPCBasebandParam(
        rfidConfig.value.epcBasebandRate,
        rfidConfig.value.defaultQ,
        rfidConfig.value.session,
        rfidConfig.value.inventoryFlag
    )
    appendLog('EPC 基带参数配置成功')
    message.success('EPC 基带参数配置成功')
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`配置 EPC 基带参数失败: ${messageText}`)
    message.error(messageText)
  }
}

function sendRawHex() {
  try {
    const payload = normalizeHex(rfidConfig.value.rawHex)
    if (!payload) {
      throw new Error('请输入待发送的 HEX')
    }
    guoxinSingleDevice.sendMessageNew(payload)
    appendLog(`TX: ${payload}`)
  } catch (error) {
    const messageText = resolveError(error)
    appendLog(`发送失败: ${messageText}`)
    message.error(messageText)
  }
}

function clearLog() {
  log.value = ''
}

watch(() => rfidConfig.value.mode, async (nextMode, prevMode) => {
  if (nextMode === prevMode) return
  stopContinuousRead?.()
  stopContinuousRead = null
  try {
    await guoxinSingleDevice.disconnect(prevMode)
  } catch {
    // 旧通道可能本来就未连接，直接切模式即可。
  }
  guoxinSingleDevice.setMode(nextMode)
  if (nextMode === 'serial') {
    void refreshPorts()
  }
})

watch(() => rfidConfig.value.antennaCount, (nextCount) => {
  syncDeviceAntNum()
  const antennas = normalizeAntennaSelection(rfidConfig.value.antsInput, nextCount)
  const nextValue = antennas.join(',')
  if (nextValue !== rfidConfig.value.antsInput) {
    rfidStore.setConfig({antsInput: nextValue})
  }
})

onMounted(() => {
  if (rfidConfig.value.mode === 'serial') {
    void refreshPorts()
  }

  disposeStatusListener = guoxinSingleDevice.subscribeStatus((state) => {
    connected.value = state.connected
    lastError.value = state.lastError ?? ''
  })

  disposeRawListener = guoxinSingleDevice.subscribeRawData((source, data) => {
    if (source !== rfidConfig.value.mode) return
    appendLog(`${source.toUpperCase()} RX: ${data}`)
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
    <a-space direction="vertical" size="large" style="width: 100%">
      <div class="layout-row layout-row-top">
        <a-card title="连接与设备">
          <a-space direction="vertical" style="width: 100%">
            <a-segmented v-model:value="rfidConfig.mode" :options="modeOptions"/>

            <template v-if="isSerial">
              <div class="serial-port-row">
                <a-select
                    v-model:value="rfidConfig.portPath"
                    :options="serialOptions"
                    placeholder="选择串口"
                    style="width: 100%"
                />
                <a-button @click="refreshPorts">刷新串口</a-button>
              </div>
              <a-input-number
                  v-model:value="rfidConfig.baudRate"
                  :min="300"
                  :step="300"
                  addon-before="波特率"
                  style="width: 100%"
              />
            </template>

            <template v-else>
              <a-input v-model:value="rfidConfig.host" addon-before="TCP 地址" placeholder="TCP 地址"/>
              <a-input-number
                  v-model:value="rfidConfig.tcpPort"
                  :min="1"
                  :max="65535"
                  addon-before="端口"
                  style="width: 100%"
              />
            </template>

            <a-space wrap>
              <a-button type="primary" @click="connect">连接</a-button>
              <a-button danger @click="disconnect">断开</a-button>
              <a-tag :color="connected ? 'green' : 'red'">
                {{ connected ? '已连接' : '未连接' }}
              </a-tag>
            </a-space>

            <a-alert
                v-if="lastError"
                :message="lastError"
                type="error"
                show-icon
            />
          </a-space>
        </a-card>

        <a-card title="功率与参数">
          <a-space direction="vertical" style="width: 100%">
            <a-input-number
                v-model:value="antennaCountModel"
                :min="1"
                :max="32"
                addon-before="天线数"
                style="width: 100%"
            />

            <a-divider style="margin: 8px 0"/>

            <a-typography-text type="secondary">
              {{ formatPowerLevels(rfidConfig.powerLevels) }}
            </a-typography-text>
            <a-space wrap>
              <a-button @click="openPowerConfigModal">设置功率</a-button>
              <a-button @click="loadAllPower">读取功率</a-button>
            </a-space>

            <a-divider style="margin: 8px 0"/>

            <a-input-number
                v-model:value="rfidConfig.epcBasebandRate"
                :min="0"
                :max="255"
                addon-before="基带速率"
                style="width: 100%"
            />
            <a-input-number
                v-model:value="rfidConfig.defaultQ"
                :min="0"
                :max="255"
                addon-before="默认Q"
                style="width: 100%"
            />
            <a-input-number
                v-model:value="rfidConfig.session"
                :min="0"
                :max="255"
                addon-before="Session"
                style="width: 100%"
            />
            <a-input-number
                v-model:value="rfidConfig.inventoryFlag"
                :min="0"
                :max="255"
                addon-before="盘存标志"
                style="width: 100%"
            />
            <a-button @click="applyBasebandConfig">配置 EPC 基带参数</a-button>
          </a-space>
        </a-card>
      </div>

      <div class="layout-row layout-row-bottom">
        <a-card title="盘存测试">
          <template #extra>
            <a-tag color="blue">{{ inventoryStatus }}</a-tag>
          </template>
          <a-space direction="vertical" style="width: 100%">
            <a-select
                v-model:value="inventoryAntennasModel"
                :options="inventoryAntennaOptions"
                mode="multiple"
                placeholder="选择盘存天线"
                style="width: 100%"
            />
            <a-space wrap>
              <a-button type="primary" @click="startSingleRead">单次读取</a-button>
              <a-button @click="startContinuousRead">连续读取</a-button>
              <a-button danger @click="stopInventory">停止读取</a-button>
            </a-space>
            <a-descriptions
                v-if="latestTag"
                bordered
                :column="1"
                size="small"
                title="最近标签"
            >
              <a-descriptions-item label="EPC">{{ latestTag.epc }}</a-descriptions-item>
              <a-descriptions-item label="PC">{{ latestTag.pcValue }}</a-descriptions-item>
              <a-descriptions-item label="天线">{{ latestTag.antennaId }}</a-descriptions-item>
              <a-descriptions-item label="RSSI">
                {{ latestTag.rssi?.value ?? '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="TID">
                {{ latestTag.tidData?.data ?? '-' }}
              </a-descriptions-item>
            </a-descriptions>
          </a-space>
        </a-card>

        <a-card title="写标签测试">
          <a-space direction="vertical" style="width: 100%">
            <a-alert
                message="首次写入会依次执行：改密码 -> 锁灭活/认证/EPC/用户区 -> 写 EPC；再次写入直接走 writeEPC。"
                type="info"
                show-icon
            />
            <a-input-number
                v-model:value="rfidConfig.writeAntenna"
                :min="1"
                :max="32"
                addon-before="写入天线"
                style="width: 100%"
            />
            <a-input
                v-model:value="rfidConfig.writeTid"
                addon-before="标签 TID"
                placeholder="标签 TID，HEX"
            />
            <a-input
                v-model:value="rfidConfig.writeEpc"
                addon-before="待写 EPC"
                placeholder="待写 EPC，HEX"
            />
            <a-input
                v-model:value="rfidConfig.accessPassword"
                addon-before="访问密码"
                placeholder="访问密码，8位HEX"
            />
            <a-input
                v-model:value="rfidConfig.oldAccessPassword"
                addon-before="旧访问密码"
                placeholder="旧访问密码，8位HEX，仅首次写入使用"
            />
            <a-input
                v-model:value="rfidConfig.killPassword"
                addon-before="灭活密码"
                placeholder="灭活密码，8位HEX"
            />
            <a-space wrap>
              <a-button @click="useLatestTagForWrite">带入最近标签</a-button>
              <a-button type="primary" @click="firstWriteTag">首次写入</a-button>
              <a-button @click="rewriteTag">再次写入</a-button>
            </a-space>
          </a-space>
        </a-card>

        <a-card title="原始 HEX 调试">
          <a-space direction="vertical" style="width: 100%">
            <a-input
                v-model:value="rfidConfig.rawHex"
                addon-before="原始 HEX"
                placeholder="输入原始 HEX 帧"
            />
            <a-space wrap>
              <a-button @click="sendRawHex">发送 HEX</a-button>
              <a-button danger @click="clearLog">清空日志</a-button>
            </a-space>
            <a-textarea
                v-model:value="log"
                :rows="12"
                class="log-textarea"
                placeholder="收发日志"
            />
          </a-space>
        </a-card>
      </div>
    </a-space>

    <a-modal
        v-model:open="powerModalVisible"
        title="设置天线功率"
        :confirm-loading="powerSubmitting"
        @ok="applyPowerConfig"
    >
      <a-space direction="vertical" style="width: 100%">
        <a-typography-text type="secondary">
          当前设备天线数：{{ rfidConfig.antennaCount }}
        </a-typography-text>
        <div class="power-grid">
          <a-input-number
              v-for="(_, index) in powerEditor"
              :key="`power-editor-${index}`"
              v-model:value="powerEditor[index]"
              :min="0"
              :max="33"
              :addon-before="`天线${index + 1}`"
              style="width: 100%"
          />
        </div>
      </a-space>
    </a-modal>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
}

.layout-row {
  display: grid;
  gap: 16px;
  align-items: stretch;
}

.layout-row > .ant-card {
  height: 100%;
}

.layout-row-top {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.layout-row-bottom {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.serial-port-row {
  display: flex;
  gap: 8px;
}

.serial-port-row :deep(.ant-select) {
  flex: 1;
  min-width: 0;
}

.power-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .power-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.log-textarea :deep(textarea) {
  font-family: 'SFMono-Regular', 'Monaco', 'Consolas', monospace;
}
</style>

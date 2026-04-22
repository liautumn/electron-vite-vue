<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Notify, type QTableColumn } from 'quasar'
import DeviceSettingsButton from './DeviceSettingsButton.vue'
import { useDeviceConnectionsManager } from '../composables/useDeviceConnectionsManager'
import type { LockConnectionProfile, RfidConnectionProfile } from '../stores/deviceConnections'

defineOptions({ name: 'device-connections-control' })

type DeviceTab = 'rfid' | 'lock'
type EditorMode = 'create' | 'edit'

type RfidTableRow = {
  id: string
  name: string
  sessionId: number
  mode: RfidConnectionProfile['mode']
  endpoint: string
  antennaCount: number
  connected: boolean
  isActive: boolean
  lastError: string | null
  profile: RfidConnectionProfile
}

type LockTableRow = {
  id: string
  name: string
  sessionId: number
  portPath: string
  baudRate: number
  connected: boolean
  isActive: boolean
  lastError: string | null
  profile: LockConnectionProfile
}

const {
  rfidProfiles,
  lockProfiles,
  activeRfidSessionId,
  activeLockSessionId,
  serialOptions,
  loadingSerialOptions,
  connectedRfidCount,
  connectedLockCount,
  refreshSerialOptions,
  connectRfidProfile,
  disconnectRfidProfile,
  connectLockProfile,
  disconnectLockProfile,
  getRfidRuntimeStatus,
  getLockRuntimeStatus,
  setActiveRfidSession,
  setActiveLockSession,
  addRfidProfile,
  removeRfidProfile,
  addLockProfile,
  removeLockProfile
} = useDeviceConnectionsManager()

const deviceSettingsVisible = ref(false)
const deviceSettingsTab = ref<DeviceTab>('rfid')
const editorVisible = ref(false)
const editorKind = ref<DeviceTab>('rfid')
const editorMode = ref<EditorMode>('create')
const editingProfileId = ref('')
const tablePagination = { rowsPerPage: 10 }

const rfidForm = reactive({
  name: '',
  sessionId: 0 as number | null,
  mode: 'tcp' as RfidConnectionProfile['mode'],
  portPath: '',
  baudRate: 9600 as number | null,
  host: '192.168.1.168',
  tcpPort: 8160 as number | null,
  antennaCount: 4 as number | null
})

const lockForm = reactive({
  name: '',
  sessionId: 0 as number | null,
  portPath: '',
  baudRate: 9600 as number | null
})

const rfidColumns: QTableColumn<RfidTableRow>[] = [
  { name: 'status', label: '状态', field: 'connected', align: 'left' },
  { name: 'current', label: '当前会话', field: 'isActive', align: 'left' },
  { name: 'name', label: '设备名称', field: 'name', align: 'left' },
  { name: 'sessionId', label: 'Session ID', field: 'sessionId', align: 'left', sortable: true },
  { name: 'mode', label: '连接方式', field: 'mode', align: 'left' },
  { name: 'endpoint', label: '连接目标', field: 'endpoint', align: 'left' },
  { name: 'antennaCount', label: '天线数', field: 'antennaCount', align: 'left' },
  { name: 'lastError', label: '最近错误', field: 'lastError', align: 'left' },
  { name: 'actions', label: '操作', field: 'id', align: 'left' }
]

const lockColumns: QTableColumn<LockTableRow>[] = [
  { name: 'status', label: '状态', field: 'connected', align: 'left' },
  { name: 'current', label: '当前会话', field: 'isActive', align: 'left' },
  { name: 'name', label: '设备名称', field: 'name', align: 'left' },
  { name: 'sessionId', label: 'Session ID', field: 'sessionId', align: 'left', sortable: true },
  { name: 'portPath', label: '串口', field: 'portPath', align: 'left' },
  { name: 'baudRate', label: '波特率', field: 'baudRate', align: 'left' },
  { name: 'lastError', label: '最近错误', field: 'lastError', align: 'left' },
  { name: 'actions', label: '操作', field: 'id', align: 'left' }
]

const rfidRows = computed<RfidTableRow[]>(() =>
  rfidProfiles.value.map((profile) => {
    const runtime = getRfidRuntimeStatus(profile.sessionId)
    const endpoint =
      profile.mode === 'serial'
        ? `${profile.portPath || '未选择串口'} / ${profile.baudRate || 9600}`
        : `${profile.host || '-'}:${profile.tcpPort || '-'}`

    return {
      id: profile.id,
      name: profile.name,
      sessionId: profile.sessionId,
      mode: profile.mode,
      endpoint,
      antennaCount: profile.antennaCount,
      connected: runtime.connected,
      isActive: activeRfidSessionId.value === profile.sessionId,
      lastError: runtime.lastError,
      profile
    }
  })
)

const lockRows = computed<LockTableRow[]>(() =>
  lockProfiles.value.map((profile) => {
    const runtime = getLockRuntimeStatus(profile.sessionId)
    return {
      id: profile.id,
      name: profile.name,
      sessionId: profile.sessionId,
      portPath: profile.portPath || '未选择串口',
      baudRate: profile.baudRate,
      connected: runtime.connected,
      isActive: activeLockSessionId.value === profile.sessionId,
      lastError: runtime.lastError,
      profile
    }
  })
)

const editorTitle = computed(() => {
  const action = editorMode.value === 'create' ? '新增' : '编辑'
  return `${action}${editorKind.value === 'rfid' ? ' RFID 连接' : ' Lock 连接'}`
})

const isEditingConnectedProfile = computed(() => {
  if (editorMode.value !== 'edit' || !editingProfileId.value) {
    return false
  }

  if (editorKind.value === 'rfid') {
    const profile = rfidProfiles.value.find((item) => item.id === editingProfileId.value)
    return profile ? getRfidRuntimeStatus(profile.sessionId).connected : false
  }

  const profile = lockProfiles.value.find((item) => item.id === editingProfileId.value)
  return profile ? getLockRuntimeStatus(profile.sessionId).connected : false
})

const resolveError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const requireText = (value: string, label: string) => {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label}不能为空`)
  }
  return normalized
}

const requireInteger = (
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {}
) => {
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

const ensureUniqueSession = (
  sessionId: number,
  items: Array<{ id: string; sessionId: number }>,
  currentId: string,
  label: string
) => {
  if (items.some((item) => item.id !== currentId && item.sessionId === sessionId)) {
    throw new Error(`${label}会话 ID 不能重复`)
  }
}

const getNextSessionId = (items: Array<{ sessionId: number }>) =>
  Math.max(-1, ...items.map((item) => Number(item.sessionId) || 0)) + 1

const resetRfidForm = () => {
  const nextSessionId = getNextSessionId(rfidProfiles.value)
  rfidForm.name = `RFID-${nextSessionId}`
  rfidForm.sessionId = nextSessionId
  rfidForm.mode = 'tcp'
  rfidForm.portPath = ''
  rfidForm.baudRate = 9600
  rfidForm.host = '192.168.1.168'
  rfidForm.tcpPort = 8160
  rfidForm.antennaCount = 4
}

const resetLockForm = () => {
  const nextSessionId = getNextSessionId(lockProfiles.value)
  lockForm.name = `Lock-${nextSessionId}`
  lockForm.sessionId = nextSessionId
  lockForm.portPath = ''
  lockForm.baudRate = 9600
}

const openCreateDialog = (kind: DeviceTab) => {
  editorKind.value = kind
  editorMode.value = 'create'
  editingProfileId.value = ''

  if (kind === 'rfid') {
    resetRfidForm()
  } else {
    resetLockForm()
  }

  editorVisible.value = true
}

const openEditRfidDialog = (profile: RfidConnectionProfile) => {
  editorKind.value = 'rfid'
  editorMode.value = 'edit'
  editingProfileId.value = profile.id
  rfidForm.name = profile.name
  rfidForm.sessionId = profile.sessionId
  rfidForm.mode = profile.mode
  rfidForm.portPath = profile.portPath
  rfidForm.baudRate = profile.baudRate
  rfidForm.host = profile.host
  rfidForm.tcpPort = profile.tcpPort
  rfidForm.antennaCount = profile.antennaCount
  editorVisible.value = true
}

const openEditLockDialog = (profile: LockConnectionProfile) => {
  editorKind.value = 'lock'
  editorMode.value = 'edit'
  editingProfileId.value = profile.id
  lockForm.name = profile.name
  lockForm.sessionId = profile.sessionId
  lockForm.portPath = profile.portPath
  lockForm.baudRate = profile.baudRate
  editorVisible.value = true
}

const normalizeRfidForm = () => {
  const sessionId = requireInteger(rfidForm.sessionId, 'Session ID')
  const baudRate = requireInteger(rfidForm.baudRate, '波特率', { min: 300 })
  const antennaCount = requireInteger(rfidForm.antennaCount, '天线数', { min: 1, max: 32 })
  const payload = {
    name: requireText(rfidForm.name, '设备名称'),
    sessionId,
    mode: rfidForm.mode,
    portPath: '',
    baudRate,
    host: '',
    tcpPort: 0,
    antennaCount
  }

  if (rfidForm.mode === 'serial') {
    payload.portPath = requireText(rfidForm.portPath, '串口')
    return payload
  }

  payload.host = requireText(rfidForm.host, 'TCP 地址')
  payload.tcpPort = requireInteger(rfidForm.tcpPort, '端口', { min: 1, max: 65535 })
  return payload
}

const normalizeLockForm = () => ({
  name: requireText(lockForm.name, '设备名称'),
  sessionId: requireInteger(lockForm.sessionId, 'Session ID'),
  portPath: requireText(lockForm.portPath, '串口'),
  baudRate: requireInteger(lockForm.baudRate, '波特率', { min: 300 })
})

const closeEditor = () => {
  editorVisible.value = false
  editingProfileId.value = ''
}

const submitEditor = () => {
  try {
    if (editorKind.value === 'rfid') {
      const payload = normalizeRfidForm()
      ensureUniqueSession(
        payload.sessionId,
        rfidProfiles.value,
        editorMode.value === 'edit' ? editingProfileId.value : '',
        'RFID'
      )

      if (editorMode.value === 'create') {
        const created = addRfidProfile()
        Object.assign(created, payload)
      } else {
        const target = rfidProfiles.value.find((item) => item.id === editingProfileId.value)
        if (!target) {
          throw new Error('未找到要编辑的 RFID 设备')
        }

        const previousSessionId = target.sessionId
        Object.assign(target, payload)

        if (activeRfidSessionId.value === previousSessionId) {
          setActiveRfidSession(payload.sessionId)
        }
      }

      Notify.create({
        type: 'positive',
        message: editorMode.value === 'create' ? 'RFID 设备已新增' : 'RFID 设备已更新',
        position: 'top-right',
        timeout: 2200
      })
    } else {
      const payload = normalizeLockForm()
      ensureUniqueSession(
        payload.sessionId,
        lockProfiles.value,
        editorMode.value === 'edit' ? editingProfileId.value : '',
        'Lock'
      )

      if (editorMode.value === 'create') {
        const created = addLockProfile()
        Object.assign(created, payload)
      } else {
        const target = lockProfiles.value.find((item) => item.id === editingProfileId.value)
        if (!target) {
          throw new Error('未找到要编辑的 Lock 设备')
        }

        const previousSessionId = target.sessionId
        Object.assign(target, payload)

        if (activeLockSessionId.value === previousSessionId) {
          setActiveLockSession(payload.sessionId)
        }
      }

      Notify.create({
        type: 'positive',
        message: editorMode.value === 'create' ? 'Lock 设备已新增' : 'Lock 设备已更新',
        position: 'top-right',
        timeout: 2200
      })
    }

    closeEditor()
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: resolveError(error),
      position: 'top-right',
      timeout: 2200
    })
  }
}

const handleRemoveRfid = (profile: RfidConnectionProfile) => {
  removeRfidProfile(profile.id)
  Notify.create({
    type: 'positive',
    message: 'RFID 设备已删除',
    position: 'top-right',
    timeout: 2200
  })
}

const handleRemoveLock = (profile: LockConnectionProfile) => {
  removeLockProfile(profile.id)
  Notify.create({
    type: 'positive',
    message: 'Lock 设备已删除',
    position: 'top-right',
    timeout: 2200
  })
}
</script>

<template>
  <div class="device-control">
    <DeviceSettingsButton
      :connected-rfid-count="connectedRfidCount"
      :connected-lock-count="connectedLockCount"
      @click="deviceSettingsVisible = true"
    />

    <q-dialog v-model="deviceSettingsVisible" persistent maximized>
      <q-card class="device-settings-card">
        <q-card-section class="device-settings-header">
          <div>
            <div class="device-settings-title">设备连接管理</div>
            <div class="device-settings-subtitle">RFID 与 Lock 会话统一管理</div>
          </div>

          <div class="device-settings-actions">
            <q-btn
              outline
              color="primary"
              no-caps
              icon="refresh"
              :loading="loadingSerialOptions"
              @click="refreshSerialOptions"
            >
              刷新串口
            </q-btn>
            <q-btn flat no-caps @click="deviceSettingsVisible = false">关闭</q-btn>
          </div>
        </q-card-section>

        <q-separator />

        <q-tabs
          v-model="deviceSettingsTab"
          align="left"
          dense
          active-color="primary"
          indicator-color="primary"
          class="device-settings-tabs"
        >
          <q-tab name="rfid" :label="`RFID (${connectedRfidCount})`" />
          <q-tab name="lock" :label="`Lock (${connectedLockCount})`" />
        </q-tabs>

        <q-separator />

        <q-tab-panels v-model="deviceSettingsTab" animated class="device-settings-panels">
          <q-tab-panel name="rfid" class="device-settings-panel">
            <q-table
              flat
              bordered
              row-key="id"
              :rows="rfidRows"
              :columns="rfidColumns"
              :pagination="tablePagination"
              class="device-table"
            >
              <template #top>
                <div class="table-toolbar">
                  <div>
                    <div class="table-title">RFID 设备</div>
                    <div class="table-subtitle">支持串口和 TCP 多会话连接</div>
                  </div>

                  <q-btn color="primary" icon="add" no-caps unelevated @click="openCreateDialog('rfid')">
                    新增 RFID
                  </q-btn>
                </div>
              </template>

              <template #body-cell-status="{ row }">
                <q-td>
                  <q-chip
                    square
                    dense
                    :color="row.connected ? 'positive' : 'negative'"
                    text-color="white"
                  >
                    {{ row.connected ? '已连接' : '未连接' }}
                  </q-chip>
                </q-td>
              </template>

              <template #body-cell-current="{ row }">
                <q-td>
                  <q-badge v-if="row.isActive" color="primary">当前</q-badge>
                  <span v-else class="cell-muted">-</span>
                </q-td>
              </template>

              <template #body-cell-mode="{ row }">
                <q-td>{{ row.mode === 'serial' ? 'RS232' : 'TCP' }}</q-td>
              </template>

              <template #body-cell-lastError="{ row }">
                <q-td class="cell-error">
                  {{ row.lastError || '-' }}
                </q-td>
              </template>

              <template #body-cell-actions="{ row }">
                <q-td>
                  <div class="table-actions">
                    <q-btn
                      dense
                      outline
                      color="primary"
                      no-caps
                      :disable="row.isActive"
                      @click="setActiveRfidSession(row.sessionId)"
                    >
                      {{ row.isActive ? '当前会话' : '设为当前' }}
                    </q-btn>
                    <q-btn dense flat round color="primary" icon="edit" @click="openEditRfidDialog(row.profile)" />
                    <q-btn
                      dense
                      color="primary"
                      no-caps
                      unelevated
                      @click="connectRfidProfile(row.profile)"
                    >
                      连接
                    </q-btn>
                    <q-btn
                      dense
                      color="negative"
                      no-caps
                      unelevated
                      @click="disconnectRfidProfile(row.profile)"
                    >
                      断开
                    </q-btn>
                    <q-btn
                      dense
                      flat
                      round
                      color="negative"
                      icon="delete"
                      :disable="row.connected || rfidProfiles.length <= 1"
                      @click="handleRemoveRfid(row.profile)"
                    />
                  </div>
                </q-td>
              </template>
            </q-table>
          </q-tab-panel>

          <q-tab-panel name="lock" class="device-settings-panel">
            <q-table
              flat
              bordered
              row-key="id"
              :rows="lockRows"
              :columns="lockColumns"
              :pagination="tablePagination"
              class="device-table"
            >
              <template #top>
                <div class="table-toolbar">
                  <div>
                    <div class="table-title">Lock 设备</div>
                    <div class="table-subtitle">锁控板串口多会话连接</div>
                  </div>

                  <q-btn color="primary" icon="add" no-caps unelevated @click="openCreateDialog('lock')">
                    新增 Lock
                  </q-btn>
                </div>
              </template>

              <template #body-cell-status="{ row }">
                <q-td>
                  <q-chip
                    square
                    dense
                    :color="row.connected ? 'positive' : 'negative'"
                    text-color="white"
                  >
                    {{ row.connected ? '已连接' : '未连接' }}
                  </q-chip>
                </q-td>
              </template>

              <template #body-cell-current="{ row }">
                <q-td>
                  <q-badge v-if="row.isActive" color="primary">当前</q-badge>
                  <span v-else class="cell-muted">-</span>
                </q-td>
              </template>

              <template #body-cell-lastError="{ row }">
                <q-td class="cell-error">
                  {{ row.lastError || '-' }}
                </q-td>
              </template>

              <template #body-cell-actions="{ row }">
                <q-td>
                  <div class="table-actions">
                    <q-btn
                      dense
                      outline
                      color="primary"
                      no-caps
                      :disable="row.isActive"
                      @click="setActiveLockSession(row.sessionId)"
                    >
                      {{ row.isActive ? '当前会话' : '设为当前' }}
                    </q-btn>
                    <q-btn dense flat round color="primary" icon="edit" @click="openEditLockDialog(row.profile)" />
                    <q-btn
                      dense
                      color="primary"
                      no-caps
                      unelevated
                      @click="connectLockProfile(row.profile)"
                    >
                      连接
                    </q-btn>
                    <q-btn
                      dense
                      color="negative"
                      no-caps
                      unelevated
                      @click="disconnectLockProfile(row.profile)"
                    >
                      断开
                    </q-btn>
                    <q-btn
                      dense
                      flat
                      round
                      color="negative"
                      icon="delete"
                      :disable="row.connected || lockProfiles.length <= 1"
                      @click="handleRemoveLock(row.profile)"
                    />
                  </div>
                </q-td>
              </template>
            </q-table>
          </q-tab-panel>
        </q-tab-panels>
      </q-card>
    </q-dialog>

    <q-dialog v-model="editorVisible" persistent>
      <q-card class="editor-card">
        <q-card-section class="editor-header">
          <div class="editor-title">{{ editorTitle }}</div>
          <q-btn flat round dense icon="close" @click="closeEditor" />
        </q-card-section>

        <q-separator />

        <q-card-section class="editor-body">
          <q-banner v-if="isEditingConnectedProfile" dense rounded class="editor-banner">
            当前设备已连接，需先断开后才能修改会话和连接参数。
          </q-banner>

          <template v-if="editorKind === 'rfid'">
            <div class="editor-grid">
              <q-input v-model="rfidForm.name" outlined label="设备名称" />
              <q-input
                v-model.number="rfidForm.sessionId"
                outlined
                type="number"
                min="0"
                label="Session ID"
                :disable="isEditingConnectedProfile"
              />

              <q-btn-toggle
                v-model="rfidForm.mode"
                no-caps
                rounded
                unelevated
                toggle-color="primary"
                :disable="isEditingConnectedProfile"
                :options="[
                  { label: 'RS232', value: 'serial' },
                  { label: 'TCP', value: 'tcp' }
                ]"
              />

              <q-input
                v-model.number="rfidForm.antennaCount"
                outlined
                type="number"
                min="1"
                max="32"
                label="天线数"
                :disable="isEditingConnectedProfile"
              />

              <template v-if="rfidForm.mode === 'serial'">
                <q-select
                  v-model="rfidForm.portPath"
                  outlined
                  emit-value
                  map-options
                  label="串口"
                  :options="serialOptions"
                  :disable="isEditingConnectedProfile"
                />
                <q-input
                  v-model.number="rfidForm.baudRate"
                  outlined
                  type="number"
                  min="300"
                  step="300"
                  label="波特率"
                  :disable="isEditingConnectedProfile"
                />
              </template>

              <template v-else>
                <q-input
                  v-model="rfidForm.host"
                  outlined
                  label="TCP 地址"
                  :disable="isEditingConnectedProfile"
                />
                <q-input
                  v-model.number="rfidForm.tcpPort"
                  outlined
                  type="number"
                  min="1"
                  max="65535"
                  label="端口"
                  :disable="isEditingConnectedProfile"
                />
              </template>
            </div>
          </template>

          <template v-else>
            <div class="editor-grid">
              <q-input v-model="lockForm.name" outlined label="设备名称" />
              <q-input
                v-model.number="lockForm.sessionId"
                outlined
                type="number"
                min="0"
                label="Session ID"
                :disable="isEditingConnectedProfile"
              />
              <q-select
                v-model="lockForm.portPath"
                outlined
                emit-value
                map-options
                label="串口"
                :options="serialOptions"
                :disable="isEditingConnectedProfile"
              />
              <q-input
                v-model.number="lockForm.baudRate"
                outlined
                type="number"
                min="300"
                step="300"
                label="波特率"
                :disable="isEditingConnectedProfile"
              />
            </div>
          </template>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right">
          <q-btn flat no-caps @click="closeEditor">取消</q-btn>
          <q-btn color="primary" no-caps unelevated @click="submitEditor">保存</q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.device-control {
  align-items: center;
  display: flex;
}

.device-settings-card {
  background: var(--app-surface);
  border-radius: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.device-settings-header {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
}

.device-settings-title {
  font-size: 18px;
  font-weight: 600;
}

.device-settings-subtitle {
  color: var(--app-text-secondary);
  font-size: 13px;
  margin-top: 4px;
}

.device-settings-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.device-settings-tabs {
  padding: 0 12px;
}

.device-settings-panels {
  background: transparent;
  flex: 1;
}

.device-settings-panel {
  height: 100%;
  padding: 16px;
}

.device-table {
  border-color: var(--app-border);
  border-radius: 16px;
}

.table-toolbar {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  width: 100%;
}

.table-title {
  font-size: 16px;
  font-weight: 600;
}

.table-subtitle {
  color: var(--app-text-secondary);
  font-size: 13px;
  margin-top: 4px;
}

.table-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cell-muted {
  color: var(--app-text-secondary);
}

.cell-error {
  color: rgb(220, 38, 38);
  max-width: 260px;
  white-space: normal;
  word-break: break-word;
}

.editor-card {
  max-width: 720px;
  width: min(720px, calc(100vw - 32px));
}

.editor-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.editor-title {
  font-size: 18px;
  font-weight: 600;
}

.editor-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.editor-banner {
  background: color-mix(in srgb, rgb(245, 158, 11) 16%, var(--app-surface));
  color: var(--text-color);
}

.editor-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 960px) {
  .device-settings-header,
  .device-settings-actions,
  .table-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>

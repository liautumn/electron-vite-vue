<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Notify, type QTableColumn } from 'quasar'
import DeviceSettingsButton from './DeviceSettingsButton.vue'
import { useDeviceConnectionsStore, type DeviceConnectionProfile } from '../stores/deviceConnections'
import type { TransportConnectionMode } from '../types/connection'

defineOptions({ name: 'device-connections-control' })

type EditorMode = 'create' | 'edit'

type ConnectionTableRow = {
  id: string
  name: string
  sessionId: number
  mode: TransportConnectionMode
  endpoint: string
  connected: boolean
  lastError: string | null
  profile: DeviceConnectionProfile
}

type ConnectionFormPayload =
  | Omit<Extract<DeviceConnectionProfile, { mode: 'serial' }>, 'id'>
  | Omit<Extract<DeviceConnectionProfile, { mode: 'tcp' }>, 'id'>

const deviceConnectionsStore = useDeviceConnectionsStore()
const {
  connectionProfiles,
  activeRfidSessionId,
  activeLockSessionId,
  activeLedSessionId
} = storeToRefs(deviceConnectionsStore)

const getRuntimeStatus = deviceConnectionsStore.getRuntimeStatus
const addConnectionProfile = deviceConnectionsStore.addConnectionProfile
const removeConnectionProfile = deviceConnectionsStore.removeConnectionProfile
const setActiveRfidSession = deviceConnectionsStore.setActiveRfidSession
const setActiveLockSession = deviceConnectionsStore.setActiveLockSession
const setActiveLedSession = deviceConnectionsStore.setActiveLedSession

const loadingSerialOptions = ref(false)
const serialOptions = ref<{ label: string; value: string }[]>([{ label: '请选择串口', value: '' }])

const connectedSerialCount = computed(
  () =>
    connectionProfiles.value.filter(
      (item) => item.mode === 'serial' && getRuntimeStatus(item.sessionId).connected
    ).length
)
const connectedTcpCount = computed(
  () =>
    connectionProfiles.value.filter(
      (item) => item.mode === 'tcp' && getRuntimeStatus(item.sessionId).connected
    ).length
)

const deviceSettingsVisible = ref(false)
const editorVisible = ref(false)
const editorMode = ref<EditorMode>('create')
const editingProfileId = ref('')
const tablePagination = { rowsPerPage: 10 }

const connectionForm = reactive({
  name: '',
  sessionId: 0 as number | null,
  mode: 'serial' as TransportConnectionMode,
  portPath: '',
  baudRate: 9600 as number | null,
  host: '192.168.1.168',
  port: 8160 as number | null
})

const columns: QTableColumn<ConnectionTableRow>[] = [
  { name: 'status', label: '状态', field: 'connected', align: 'left' },
  { name: 'name', label: '连接名称', field: 'name', align: 'left' },
  { name: 'sessionId', label: 'Session ID', field: 'sessionId', align: 'left', sortable: true },
  { name: 'mode', label: '连接方式', field: 'mode', align: 'left' },
  { name: 'endpoint', label: '连接目标', field: 'endpoint', align: 'left' },
  { name: 'lastError', label: '最近错误', field: 'lastError', align: 'left' },
  { name: 'actions', label: '操作', field: 'id', align: 'left' }
]

const rows = computed<ConnectionTableRow[]>(() =>
  [...connectionProfiles.value]
    .sort((a, b) => a.sessionId - b.sessionId)
    .map((profile) => {
      const runtime = getRuntimeStatus(profile.sessionId)
      const endpoint =
        profile.mode === 'serial'
          ? `${profile.portPath || '未选择串口'} / ${profile.baudRate || 9600}`
          : `${profile.host || '-'}:${profile.port || '-'}`

      return {
        id: profile.id,
        name: profile.name,
        sessionId: profile.sessionId,
        mode: profile.mode,
        endpoint,
        connected: runtime.connected,
        lastError: runtime.lastError,
        profile
      }
    })
)

const editorTitle = computed(() =>
  `${editorMode.value === 'create' ? '新增' : '编辑'}${
    connectionForm.mode === 'serial' ? '串口' : 'TCP'
  }连接`
)

const isEditingConnectedProfile = computed(() => {
  if (editorMode.value !== 'edit' || !editingProfileId.value) {
    return false
  }

  const profile = connectionProfiles.value.find((item) => item.id === editingProfileId.value)
  return profile ? getRuntimeStatus(profile.sessionId).connected : false
})

const resolveError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const requireSessionId = (value: unknown, label = '会话 ID') => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label}必须是大于等于 0 的整数`)
  }
  return parsed
}

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
  currentId: string
) => {
  if (items.some((item) => item.id !== currentId && item.sessionId === sessionId)) {
    throw new Error('会话 ID 不能重复')
  }
}

const refreshSerialOptions = async () => {
  loadingSerialOptions.value = true
  serialOptions.value = [{ label: '请选择串口', value: '' }]

  try {
    const ports = await window.serial.list()
    ports.forEach((item: any) => {
      serialOptions.value.push({
        label: item.friendlyName || item.path,
        value: item.path
      })
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `串口列表刷新失败: ${resolveError(error)}`,
      position: 'top',
      timeout: 2200
    })
  } finally {
    loadingSerialOptions.value = false
  }
}

const connectProfile = async (profile: DeviceConnectionProfile) => {
  try {
    const sessionId = requireSessionId(profile.sessionId)
    ensureUniqueSession(sessionId, connectionProfiles.value, profile.id)

    if (profile.mode === 'serial') {
      await window.serial.open({
        sessionId,
        path: profile.portPath,
        baudRate: Number(profile.baudRate) || 9600
      })
    } else {
      await window.tcp.connect({
        sessionId,
        host: profile.host,
        port: Number(profile.port)
      })
    }

    Notify.create({
      type: 'positive',
      message: `会话[${sessionId}]连接成功`,
      position: 'top',
      timeout: 2200
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `连接失败: ${resolveError(error)}`,
      position: 'top',
      timeout: 2200
    })
  }
}

const disconnectProfile = async (profile: DeviceConnectionProfile) => {
  try {
    const sessionId = requireSessionId(profile.sessionId)
    if (profile.mode === 'serial') {
      const session = window.serial.getSessionById(sessionId)
      await session.close()
    } else {
      const session = window.tcp.getSessionById(sessionId)
      await session.disconnect()
    }

    Notify.create({
      type: 'positive',
      message: `会话[${sessionId}]已断开`,
      position: 'top',
      timeout: 2200
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `断开失败: ${resolveError(error)}`,
      position: 'top',
      timeout: 2200
    })
  }
}

const getNextSessionId = (items: Array<{ sessionId: number }>) =>
  Math.max(-1, ...items.map((item) => Number(item.sessionId) || 0)) + 1

const resetForm = (mode: TransportConnectionMode) => {
  const nextSessionId = getNextSessionId(connectionProfiles.value)
  connectionForm.mode = mode
  connectionForm.name = `${mode === 'serial' ? 'Serial' : 'TCP'}-${nextSessionId}`
  connectionForm.sessionId = nextSessionId
  connectionForm.portPath = ''
  connectionForm.baudRate = 9600
  connectionForm.host = '192.168.1.168'
  connectionForm.port = 8160
}

const openCreateDialog = (mode: TransportConnectionMode) => {
  editorMode.value = 'create'
  editingProfileId.value = ''
  resetForm(mode)
  editorVisible.value = true
}

const openEditDialog = (profile: DeviceConnectionProfile) => {
  editorMode.value = 'edit'
  editingProfileId.value = profile.id

  connectionForm.mode = profile.mode
  connectionForm.name = profile.name
  connectionForm.sessionId = profile.sessionId

  if (profile.mode === 'serial') {
    connectionForm.portPath = profile.portPath
    connectionForm.baudRate = profile.baudRate
    connectionForm.host = '192.168.1.168'
    connectionForm.port = 8160
  } else {
    connectionForm.host = profile.host
    connectionForm.port = profile.port
    connectionForm.portPath = ''
    connectionForm.baudRate = 9600
  }

  editorVisible.value = true
}

const normalizeForm = (): ConnectionFormPayload => {
  const sessionId = requireInteger(connectionForm.sessionId, 'Session ID')
  const name = requireText(connectionForm.name, '连接名称')

  if (connectionForm.mode === 'serial') {
    return {
      name,
      sessionId,
      mode: 'serial',
      portPath: requireText(connectionForm.portPath, '串口'),
      baudRate: requireInteger(connectionForm.baudRate, '波特率', { min: 300 })
    }
  }

  return {
    name,
    sessionId,
    mode: 'tcp',
    host: requireText(connectionForm.host, 'TCP 地址'),
    port: requireInteger(connectionForm.port, '端口', { min: 1, max: 65535 })
  }
}

const closeEditor = () => {
  editorVisible.value = false
  editingProfileId.value = ''
}

const submitEditor = () => {
  try {
    const payload = normalizeForm()

    ensureUniqueSession(
      payload.sessionId,
      connectionProfiles.value,
      editorMode.value === 'edit' ? editingProfileId.value : ''
    )

    if (editorMode.value === 'create') {
      const created = addConnectionProfile(payload.mode)
      Object.assign(created, payload)
    } else {
      const target = connectionProfiles.value.find((item) => item.id === editingProfileId.value)
      if (!target) {
        throw new Error('未找到要编辑的连接')
      }

      const previousSessionId = target.sessionId
      Object.assign(target, payload)

      if (activeRfidSessionId.value === previousSessionId) {
        setActiveRfidSession(payload.sessionId)
      }
      if (activeLockSessionId.value === previousSessionId) {
        setActiveLockSession(payload.sessionId)
      }
      if (activeLedSessionId.value === previousSessionId) {
        setActiveLedSession(payload.sessionId)
      }
    }

    Notify.create({
      type: 'positive',
      message: editorMode.value === 'create' ? '连接已新增' : '连接已更新',
      position: 'top',
      timeout: 2200
    })

    closeEditor()
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: resolveError(error),
      position: 'top',
      timeout: 2200
    })
  }
}

const handleRemove = (profile: DeviceConnectionProfile) => {
  removeConnectionProfile(profile.id)
  Notify.create({
    type: 'positive',
    message: '连接已删除',
    position: 'top',
    timeout: 2200
  })
}

const statusDisposers = new Map<
  number,
  {
    mode: TransportConnectionMode
    dispose: () => void
  }
>()

const wireSessionStatus = (profile: DeviceConnectionProfile) => {
  const sessionId = requireSessionId(profile.sessionId)

  const markConnected = () => {
    deviceConnectionsStore.updateRuntimeStatus({
      sessionId,
      mode: profile.mode,
      connected: true,
      lastError: null
    })
  }

  const markDisconnected = () => {
    deviceConnectionsStore.updateRuntimeStatus({
      sessionId,
      mode: profile.mode,
      connected: false,
      lastError: getRuntimeStatus(sessionId).lastError
    })
  }

  const markError = (message: string) => {
    deviceConnectionsStore.updateRuntimeStatus({
      sessionId,
      mode: profile.mode,
      connected: false,
      lastError: String(message ?? '')
    })
  }

  if (profile.mode === 'serial') {
    const session = window.serial.getSessionById(sessionId)
    const disposers = [
      session.onOpen(markConnected),
      session.onClose(markDisconnected),
      session.onError((payload: { message: string }) => markError(payload.message))
    ]

    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }

  const session = window.tcp.getSessionById(sessionId)
  const disposers = [
    session.onConnect(markConnected),
    session.onClose(markDisconnected),
    session.onError((payload: { message: string }) => markError(payload.message))
  ]

  return () => {
    disposers.forEach((dispose) => dispose())
  }
}

watch(
  connectionProfiles,
  (profiles) => {
    const activeSessionIds = new Set<number>()

    profiles.forEach((profile) => {
      const sessionId = requireSessionId(profile.sessionId)
      activeSessionIds.add(sessionId)

      const existing = statusDisposers.get(sessionId)
      if (!existing || existing.mode !== profile.mode) {
        existing?.dispose()
        const dispose = wireSessionStatus(profile)
        statusDisposers.set(sessionId, {
          mode: profile.mode,
          dispose
        })
      }
    })

    Array.from(statusDisposers.entries()).forEach(([sessionId, entry]) => {
      if (activeSessionIds.has(sessionId)) return
      entry.dispose()
      statusDisposers.delete(sessionId)
    })
  },
  { deep: true, immediate: true }
)

onMounted(() => {
  void refreshSerialOptions()
})

onUnmounted(() => {
  statusDisposers.forEach((entry) => entry.dispose())
  statusDisposers.clear()
})
</script>

<template>
  <div class="device-control">
    <DeviceSettingsButton
      :connected-serial-count="connectedSerialCount"
      :connected-tcp-count="connectedTcpCount"
      @click="deviceSettingsVisible = true"
    />

    <q-dialog v-model="deviceSettingsVisible" persistent maximized>
      <q-card class="device-settings-card">
        <q-card-section class="device-settings-header">
          <div>
            <div class="device-settings-title">设备连接管理</div>
            <div class="device-settings-subtitle">
              仅维护 TCP / 串口下层会话，上层设备按 sessionId 复用
            </div>
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

        <q-card-section class="device-settings-panel">
          <q-table
            flat
            bordered
            row-key="id"
            :rows="rows"
            :columns="columns"
            :pagination="tablePagination"
            class="device-table"
          >
            <template #top>
              <div class="table-toolbar">
                <div>
                  <div class="table-title">下层连接会话</div>
                  <div class="table-subtitle">一个 session 绑定一个串口或 TCP 连接</div>
                </div>

                <div class="table-toolbar-actions">
                  <q-btn color="primary" icon="usb" no-caps unelevated @click="openCreateDialog('serial')">
                    新增串口
                  </q-btn>
                  <q-btn color="primary" icon="lan" no-caps unelevated @click="openCreateDialog('tcp')">
                    新增 TCP
                  </q-btn>
                </div>
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
                    flat
                    round
                    color="primary"
                    icon="edit"
                    @click="openEditDialog(row.profile)"
                  />
                  <q-btn
                    dense
                    color="primary"
                    no-caps
                    unelevated
                    @click="connectProfile(row.profile)"
                  >
                    连接
                  </q-btn>
                  <q-btn
                    dense
                    color="negative"
                    no-caps
                    unelevated
                    @click="disconnectProfile(row.profile)"
                  >
                    断开
                  </q-btn>
                  <q-btn
                    dense
                    flat
                    round
                    color="negative"
                    icon="delete"
                    :disable="row.connected || connectionProfiles.length <= 1"
                    @click="handleRemove(row.profile)"
                  />
                </div>
              </q-td>
            </template>
          </q-table>
        </q-card-section>
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
            当前连接已建立，需先断开后才能修改会话和连接参数。
          </q-banner>

          <div class="editor-grid">
            <q-input v-model="connectionForm.name" outlined label="连接名称" />
            <q-input
              v-model.number="connectionForm.sessionId"
              outlined
              type="number"
              min="0"
              label="Session ID"
              :disable="isEditingConnectedProfile"
            />

            <q-btn-toggle
              v-model="connectionForm.mode"
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

            <div />

            <template v-if="connectionForm.mode === 'serial'">
              <q-select
                v-model="connectionForm.portPath"
                outlined
                emit-value
                map-options
                label="串口"
                :options="serialOptions"
                :disable="isEditingConnectedProfile"
              />
              <q-input
                v-model.number="connectionForm.baudRate"
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
                v-model="connectionForm.host"
                outlined
                label="TCP 地址"
                :disable="isEditingConnectedProfile"
              />
              <q-input
                v-model.number="connectionForm.port"
                outlined
                type="number"
                min="1"
                max="65535"
                label="端口"
                :disable="isEditingConnectedProfile"
              />
            </template>
          </div>
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

.table-toolbar-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

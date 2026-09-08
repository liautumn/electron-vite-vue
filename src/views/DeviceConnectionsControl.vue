<script setup lang="ts">
import {computed, onMounted, onUnmounted, reactive, ref, watch} from 'vue'
import {storeToRefs} from 'pinia'
import {ElMessage} from 'element-plus'
import {
  Connection,
  Refresh,
  Setting
} from '@element-plus/icons-vue'
import {
  DEFAULT_SERIAL_BAUD_RATE,
  DEFAULT_TCP_HOST,
  DEFAULT_TCP_PORT,
  useDeviceConnectionsStore,
  type DeviceConnectionProfile
} from '../stores/deviceConnections'
import type {TransportConnectionMode} from '../types/connection'

defineOptions({name: 'device-connections-control'})

type EditorMode = 'create' | 'edit'

type ConnectionTableRow = {
  id: string
  name: string
  sessionId: number
  mode: TransportConnectionMode
  endpoint: string
  connected: boolean
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
const serialOptions = ref<{ label: string; value: string }[]>([{label: '请选择串口', value: ''}])

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

const connectionForm = reactive({
  name: '',
  sessionId: 0 as number | null,
  mode: 'serial' as TransportConnectionMode,
  portPath: '',
  baudRate: DEFAULT_SERIAL_BAUD_RATE as number | null,
  host: DEFAULT_TCP_HOST,
  port: DEFAULT_TCP_PORT as number | null
})

const rows = computed<ConnectionTableRow[]>(() =>
    [...connectionProfiles.value]
        .sort((a, b) => a.sessionId - b.sessionId)
        .map((profile) => {
          const runtime = getRuntimeStatus(profile.sessionId)
          const endpoint =
              profile.mode === 'serial'
                  ? `${profile.portPath || '未选择串口'} / ${profile.baudRate || DEFAULT_SERIAL_BAUD_RATE}`
                  : `${profile.host || '-'}:${profile.port || '-'}`

          return {
            id: profile.id,
            name: profile.name,
            sessionId: profile.sessionId,
            mode: profile.mode,
            endpoint,
            connected: runtime.connected,
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
  const {min = 0, max} = options

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
  serialOptions.value = [{label: '请选择串口', value: ''}]

  try {
    const ports = await window.serial.list()
    ports.forEach((item: any) => {
      serialOptions.value.push({
        label: item.friendlyName || item.path,
        value: item.path
      })
    })
  } catch (error) {
    ElMessage.error(`串口列表刷新失败: ${resolveError(error)}`)
  } finally {
    loadingSerialOptions.value = false
  }
}

const connectProfile = async (
    profile: DeviceConnectionProfile,
    {notify = true}: {notify?: boolean} = {}
) => {
  try {
    const sessionId = requireSessionId(profile.sessionId)
    ensureUniqueSession(sessionId, connectionProfiles.value, profile.id)

    if (profile.mode === 'serial') {
      await window.serial.open({
        sessionId,
        path: profile.portPath,
        baudRate: Number(profile.baudRate) || DEFAULT_SERIAL_BAUD_RATE
      })
    } else {
      await window.tcp.connect({
        sessionId,
        host: profile.host,
        port: Number(profile.port)
      })
    }

    if (notify) ElMessage.success(`会话[${sessionId}]连接成功`)
    return true
  } catch (error) {
    const message = resolveError(error)
    const sessionId = Number(profile.sessionId)

    if (Number.isInteger(sessionId) && sessionId >= 0) {
      deviceConnectionsStore.updateRuntimeStatus({
        sessionId,
        mode: profile.mode,
        connected: false
      })
    }

    if (notify) ElMessage.error(`连接失败: ${message}`)
    return false
  }
}

const initializeConnections = async () => {
  const profiles = connectionProfiles.value.filter(
      (profile) => !getRuntimeStatus(profile.sessionId).connected
  )

  await Promise.all(
      profiles.map((profile) => connectProfile(profile, {notify: false}))
  )
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

    ElMessage.success(`会话[${sessionId}]已断开`)
    return true
  } catch (error) {
    ElMessage.error(`断开失败: ${resolveError(error)}`)
    return false
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
  connectionForm.baudRate = DEFAULT_SERIAL_BAUD_RATE
  connectionForm.host = DEFAULT_TCP_HOST
  connectionForm.port = DEFAULT_TCP_PORT
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
    connectionForm.host = DEFAULT_TCP_HOST
    connectionForm.port = DEFAULT_TCP_PORT
  } else {
    connectionForm.host = profile.host
    connectionForm.port = profile.port
    connectionForm.portPath = ''
    connectionForm.baudRate = DEFAULT_SERIAL_BAUD_RATE
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
      baudRate: requireInteger(connectionForm.baudRate, '波特率', {min: 300})
    }
  }

  return {
    name,
    sessionId,
    mode: 'tcp',
    host: requireText(connectionForm.host, 'TCP 地址'),
    port: requireInteger(connectionForm.port, '端口', {min: 1, max: 65535})
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

    ElMessage.success(editorMode.value === 'create' ? '连接已新增' : '连接已更新')

    closeEditor()
  } catch (error) {
    ElMessage.error(resolveError(error))
  }
}

const handleRemove = async (profile: DeviceConnectionProfile) => {
  if (getRuntimeStatus(profile.sessionId).connected) {
    const disconnected = await disconnectProfile(profile)
    if (!disconnected) {
      return
    }
  }

  const removed = removeConnectionProfile(profile.id)
  if (!removed) {
    ElMessage.warning('连接不存在或已被删除')
    return
  }

  ElMessage.success('连接已删除')
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
      connected: true
    })
  }

  const markDisconnected = () => {
    deviceConnectionsStore.updateRuntimeStatus({
      sessionId,
      mode: profile.mode,
      connected: false
    })
  }

  if (profile.mode === 'serial') {
    const session = window.serial.getSessionById(sessionId)
    const disposers = [
      session.onOpen(markConnected),
      session.onClose(markDisconnected),
      session.onError(markDisconnected)
    ]

    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }

  const session = window.tcp.getSessionById(sessionId)
  const disposers = [
    session.onConnect(markConnected),
    session.onClose(markDisconnected),
    session.onError(markDisconnected)
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
    {deep: true, immediate: true}
)

onMounted(() => {
  void refreshSerialOptions()
  void initializeConnections()
})

onUnmounted(() => {
  statusDisposers.forEach((entry) => entry.dispose())
  statusDisposers.clear()
})
</script>

<template>
  <div class="device-control">
    <el-button type="primary" plain :icon="Setting" @click="deviceSettingsVisible = true">
      设备连接 串口:{{ connectedSerialCount }} TCP:{{ connectedTcpCount }}
    </el-button>

    <el-dialog
      v-model="deviceSettingsVisible"
      append-to-body
      title="设备连接管理"
      width="min(1200px, calc(100vw - 32px))"
      top="8vh"
      class="device-settings-dialog"
    >
      <div class="device-settings-panel">
        <div class="table-toolbar">
          <div class="table-toolbar-actions">
            <el-button
              type="primary"
              plain
              :icon="Refresh"
              :loading="loadingSerialOptions"
              @click="refreshSerialOptions"
            >
              刷新串口
            </el-button>
            <el-button type="primary" :icon="Connection" @click="openCreateDialog('serial')">新增串口</el-button>
            <el-button type="primary" :icon="Connection" @click="openCreateDialog('tcp')">新增 TCP</el-button>
          </div>
        </div>

        <el-table :data="rows" border stripe height="calc(70vh - 150px)" class="device-table">
          <el-table-column label="状态" width="82" align="center">
            <template #default="{row}">
              <el-tag :type="row.connected ? 'success' : 'danger'" effect="dark">
                {{ row.connected ? '已连接' : '未连接' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="连接名称" min-width="150" />
          <el-table-column prop="sessionId" label="Session ID" width="130" sortable align="center" />
          <el-table-column label="连接方式" width="90" align="center">
            <template #default="{row}">{{ row.mode === 'serial' ? 'RS232' : 'TCP' }}</template>
          </el-table-column>
          <el-table-column prop="endpoint" label="连接目标" min-width="210" />
          <el-table-column label="操作" width="220" fixed="right" align="center">
            <template #default="{row}">
              <div class="table-actions">
                <el-button type="primary" link @click="openEditDialog(row.profile)">编辑</el-button>
                <el-button type="primary" link :disabled="row.connected" @click="connectProfile(row.profile)">
                  连接
                </el-button>
                <el-button type="warning" link :disabled="!row.connected" @click="disconnectProfile(row.profile)">
                  断开
                </el-button>
                <el-popconfirm title="确定删除这个连接吗？" @confirm="handleRemove(row.profile)">
                  <template #reference>
                    <el-button type="danger" link>删除</el-button>
                  </template>
                </el-popconfirm>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>

    <el-dialog
      v-model="editorVisible"
      append-to-body
      :title="editorTitle"
      width="min(720px, 90vw)"
      :close-on-click-modal="false"
    >
      <el-alert
        v-if="isEditingConnectedProfile"
        title="当前连接已建立，需先断开后才能修改会话和连接参数。"
        type="warning"
        :closable="false"
        show-icon
        class="editor-banner"
      />
      <el-form label-position="top" class="editor-grid">
        <el-form-item label="连接名称">
          <el-input v-model="connectionForm.name" />
        </el-form-item>
        <el-form-item label="Session ID">
          <el-input-number v-model="connectionForm.sessionId" :min="0" :disabled="isEditingConnectedProfile" controls-position="right" />
        </el-form-item>
        <template v-if="connectionForm.mode === 'serial'">
          <el-form-item label="串口">
            <el-select v-model="connectionForm.portPath" :disabled="isEditingConnectedProfile" filterable>
              <el-option v-for="option in serialOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="波特率">
            <el-input-number v-model="connectionForm.baudRate" :min="300" :step="300" :disabled="isEditingConnectedProfile" controls-position="right" />
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="TCP 地址">
            <el-input v-model="connectionForm.host" :disabled="isEditingConnectedProfile" />
          </el-form-item>
          <el-form-item label="端口">
            <el-input-number v-model="connectionForm.port" :min="1" :max="65535" :disabled="isEditingConnectedProfile" controls-position="right" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="closeEditor">取消</el-button>
        <el-button type="primary" @click="submitEditor">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.device-control {
  align-items: center;
  display: flex;
}

.device-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.device-table {
  border-color: var(--app-border);
  border-radius: var(--el-border-radius-base);
}

.device-table :deep(.el-table__header .cell) {
  white-space: nowrap;
}

.table-toolbar {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: flex-end;
  width: 100%;
}

.table-toolbar-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.table-actions {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: center;
  white-space: nowrap;
}

.editor-banner {
  margin-bottom: 16px;
}

.editor-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(0, 1fr) 160px;
}

.editor-grid :deep(.el-form-item),
.editor-grid :deep(.el-input-number),
.editor-grid :deep(.el-select) {
  margin-bottom: 0;
  width: 100%;
}

@media (max-width: 960px) {
  .table-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

}

@media (max-width: 600px) {
  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>

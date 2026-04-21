<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Dark, Notify } from 'quasar'
import { useThemeStore, type ThemePreference } from './stores/theme'
import { useMenu } from './router/useMenu'
import {
  useDeviceConnectionsStore,
  type PadConnectionProfile,
  type RfidConnectionProfile
} from './stores/deviceConnections'
import { guoxinSingleDevice } from './components/rfid/guoxin/GuoXinSingleDevice'
import { padSingleDevice } from './components/pad/PadSingleDevice'
import DeviceSettingsButton from './components/DeviceSettingsButton.vue'

const themeStore = useThemeStore()
const { preference, resolvedTheme } = storeToRefs(themeStore)

const deviceConnectionsStore = useDeviceConnectionsStore()
const {
  rfidProfiles,
  padProfiles,
  activeRfidSessionId,
  activePadSessionId,
  rfidRuntimeMap,
  padRuntimeMap
} = storeToRefs(deviceConnectionsStore)

const deviceSettingsVisible = ref(false)
const deviceSettingsTab = ref<'rfid' | 'pad'>('rfid')
const loadingSerialOptions = ref(false)
const serialOptions = ref<{ label: string; value: string }[]>([{ label: '请选择串口', value: '' }])

const connectedRfidCount = computed(
  () => Object.values(rfidRuntimeMap.value).filter((item) => item.connected).length
)
const connectedPadCount = computed(
  () => Object.values(padRuntimeMap.value).filter((item) => item.connected).length
)

/** 主题选项 */
const themeOptions: { label: string; value: ThemePreference }[] = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '暗黑', value: 'dark' }
]

watch(
  resolvedTheme,
  (theme) => {
    Dark.set(theme === 'dark')
  },
  { immediate: true }
)

const { items, selectedKey, activeRootKey, navigate } = useMenu()
const isRootActive = (key: string) => activeRootKey.value === key
const isSelected = (key: string) => selectedKey.value === key

const resolveError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const requireSessionId = (value: unknown, label = '会话 ID') => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label}必须是大于等于 0 的整数`)
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
      position: 'top-right',
      timeout: 2200
    })
  } finally {
    loadingSerialOptions.value = false
  }
}

const connectRfidProfile = async (profile: RfidConnectionProfile) => {
  try {
    const sessionId = requireSessionId(profile.sessionId, 'RFID 会话 ID')
    ensureUniqueSession(sessionId, rfidProfiles.value, profile.id, 'RFID')

    guoxinSingleDevice.setAntNum(Math.max(1, Number(profile.antennaCount) || 1), sessionId)

    if (profile.mode === 'serial') {
      if (!profile.portPath) {
        throw new Error('请先选择 RFID 串口')
      }
      await guoxinSingleDevice.connectSerial({
        sessionId,
        path: profile.portPath,
        baudRate: Number(profile.baudRate) || 9600
      })
    } else {
      if (!profile.host || !profile.tcpPort) {
        throw new Error('请填写 RFID TCP 地址与端口')
      }
      await guoxinSingleDevice.connectTcp({
        sessionId,
        host: profile.host,
        port: Number(profile.tcpPort)
      })
    }

    deviceConnectionsStore.setActiveRfidSession(sessionId)

    Notify.create({
      type: 'positive',
      message: `RFID 会话[${sessionId}]连接成功`,
      position: 'top-right',
      timeout: 2200
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `RFID 连接失败: ${resolveError(error)}`,
      position: 'top-right',
      timeout: 2200
    })
  }
}

const disconnectRfidProfile = async (profile: RfidConnectionProfile) => {
  try {
    const sessionId = requireSessionId(profile.sessionId, 'RFID 会话 ID')
    const snapshot = guoxinSingleDevice.getSnapshot(sessionId)
    await guoxinSingleDevice.disconnect(snapshot.mode, sessionId)

    Notify.create({
      type: 'positive',
      message: `RFID 会话[${sessionId}]已断开`,
      position: 'top-right',
      timeout: 2200
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `RFID 断开失败: ${resolveError(error)}`,
      position: 'top-right',
      timeout: 2200
    })
  }
}

const connectPadProfile = async (profile: PadConnectionProfile) => {
  try {
    const sessionId = requireSessionId(profile.sessionId, 'PAD 会话 ID')
    ensureUniqueSession(sessionId, padProfiles.value, profile.id, 'PAD')

    if (!profile.portPath) {
      throw new Error('请先选择 PAD 串口')
    }

    await padSingleDevice.connectSerial({
      sessionId,
      path: profile.portPath,
      baudRate: Number(profile.baudRate) || 9600
    })

    deviceConnectionsStore.setActivePadSession(sessionId)

    Notify.create({
      type: 'positive',
      message: `PAD 会话[${sessionId}]连接成功`,
      position: 'top-right',
      timeout: 2200
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `PAD 连接失败: ${resolveError(error)}`,
      position: 'top-right',
      timeout: 2200
    })
  }
}

const disconnectPadProfile = async (profile: PadConnectionProfile) => {
  try {
    const sessionId = requireSessionId(profile.sessionId, 'PAD 会话 ID')
    await padSingleDevice.disconnect(sessionId)

    Notify.create({
      type: 'positive',
      message: `PAD 会话[${sessionId}]已断开`,
      position: 'top-right',
      timeout: 2200
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `PAD 断开失败: ${resolveError(error)}`,
      position: 'top-right',
      timeout: 2200
    })
  }
}

watch(
  activeRfidSessionId,
  (sessionId) => {
    guoxinSingleDevice.setActiveSession(sessionId)
  },
  { immediate: true }
)

watch(
  activePadSessionId,
  (sessionId) => {
    padSingleDevice.setActiveSession(sessionId)
  },
  { immediate: true }
)

let disposeRfidStatus = () => {}
let disposePadStatus = () => {}

onMounted(() => {
  void refreshSerialOptions()

  disposeRfidStatus = guoxinSingleDevice.subscribeStatus((snapshot) => {
    deviceConnectionsStore.updateRfidRuntimeStatus(snapshot)
  })

  disposePadStatus = padSingleDevice.subscribeStatus((snapshot) => {
    deviceConnectionsStore.updatePadRuntimeStatus(snapshot)
  })
})

onUnmounted(() => {
  disposeRfidStatus()
  disposePadStatus()
})
</script>
<template>
  <q-layout view="hHh lpR fFf" class="app-layout">
    <q-header class="app-header">
      <q-toolbar class="app-toolbar">
        <div class="nav-group">
          <template v-for="item in items" :key="item.key">
            <q-btn
              v-if="!item.children?.length"
              flat
              no-caps
              class="nav-btn"
              :class="{ 'nav-btn--active': isRootActive(item.key) }"
              :color="isRootActive(item.key) ? 'primary' : 'grey-7'"
              :disable="item.disabled"
              :label="item.label"
              @click="navigate(item)"
            />

            <q-btn-dropdown
              v-else
              flat
              auto-close
              no-caps
              class="nav-btn"
              :class="{ 'nav-btn--active': isRootActive(item.key) }"
              :color="isRootActive(item.key) ? 'primary' : 'grey-7'"
              :disable="item.disabled"
              :label="item.label"
            >
              <q-list dense class="nav-menu">
                <q-item
                  v-for="child in item.children"
                  :key="child.key"
                  clickable
                  :active="isSelected(child.key)"
                  :disable="child.disabled"
                  active-class="nav-item--active"
                  @click="navigate(child)"
                >
                  <q-item-section>{{ child.label }}</q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </template>
        </div>

        <q-space />

        <DeviceSettingsButton
          :connected-rfid-count="connectedRfidCount"
          :connected-pad-count="connectedPadCount"
          @click="deviceSettingsVisible = true"
        />

        <q-btn-toggle
          v-model="preference"
          class="theme-toggle"
          no-caps
          rounded
          unelevated
          toggle-color="primary"
          :options="themeOptions"
        />
      </q-toolbar>
    </q-header>

    <q-page-container class="app-page-container">
      <div class="app-content">
        <router-view />
      </div>
    </q-page-container>

    <q-footer class="app-footer">
      <div class="app-footer__inner">electron-vite-vue demo ©2026 Created by autumn</div>
    </q-footer>

    <q-dialog v-model="deviceSettingsVisible" persistent maximized>
      <q-card class="device-settings-card">
        <q-card-section class="device-settings-header">
          <div class="device-settings-title">设备会话设置</div>
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

        <q-tabs v-model="deviceSettingsTab" align="left" dense active-color="primary" indicator-color="primary">
          <q-tab name="rfid" label="RFID 多连接" />
          <q-tab name="pad" label="PAD 多连接" />
        </q-tabs>

        <q-separator />

        <q-tab-panels v-model="deviceSettingsTab" animated>
          <q-tab-panel name="rfid" class="device-settings-panel">
            <div class="device-settings-list">
              <q-card v-for="profile in rfidProfiles" :key="profile.id" flat bordered class="device-item-card">
                <q-card-section class="device-item-content">
                  <div class="device-item-grid">
                    <q-input v-model="profile.name" outlined label="设备名称" />
                    <q-input v-model.number="profile.sessionId" outlined type="number" min="0" label="Session ID" />

                    <q-btn-toggle
                      v-model="profile.mode"
                      no-caps
                      rounded
                      unelevated
                      toggle-color="primary"
                      :options="[
                        { label: 'RS232', value: 'serial' },
                        { label: 'TCP', value: 'tcp' }
                      ]"
                    />

                    <q-input
                      v-model.number="profile.antennaCount"
                      outlined
                      type="number"
                      min="1"
                      max="32"
                      label="天线数"
                    />

                    <template v-if="profile.mode === 'serial'">
                      <q-select
                        v-model="profile.portPath"
                        outlined
                        emit-value
                        map-options
                        :options="serialOptions"
                        label="串口"
                        placeholder="选择串口"
                      />
                      <q-input
                        v-model.number="profile.baudRate"
                        outlined
                        type="number"
                        min="300"
                        step="300"
                        label="波特率"
                      />
                    </template>

                    <template v-else>
                      <q-input v-model="profile.host" outlined label="TCP 地址" placeholder="TCP 地址" />
                      <q-input
                        v-model.number="profile.tcpPort"
                        outlined
                        type="number"
                        min="1"
                        max="65535"
                        label="端口"
                      />
                    </template>
                  </div>

                  <div class="device-item-actions">
                    <q-chip
                      square
                      dense
                      :color="deviceConnectionsStore.getRfidRuntimeStatus(profile.sessionId).connected ? 'positive' : 'negative'"
                      text-color="white"
                    >
                      {{ deviceConnectionsStore.getRfidRuntimeStatus(profile.sessionId).connected ? '已连接' : '未连接' }}
                    </q-chip>

                    <q-btn
                      outline
                      color="primary"
                      no-caps
                      :disable="activeRfidSessionId === profile.sessionId"
                      @click="deviceConnectionsStore.setActiveRfidSession(profile.sessionId)"
                    >
                      {{ activeRfidSessionId === profile.sessionId ? '当前会话' : '设为当前' }}
                    </q-btn>

                    <q-btn color="primary" no-caps unelevated @click="connectRfidProfile(profile)">连接</q-btn>
                    <q-btn color="negative" no-caps unelevated @click="disconnectRfidProfile(profile)">断开</q-btn>
                    <q-btn
                      flat
                      no-caps
                      color="negative"
                      :disable="rfidProfiles.length <= 1"
                      @click="deviceConnectionsStore.removeRfidProfile(profile.id)"
                    >
                      删除
                    </q-btn>
                  </div>

                  <div
                    v-if="deviceConnectionsStore.getRfidRuntimeStatus(profile.sessionId).lastError"
                    class="device-item-error"
                  >
                    最近错误：{{ deviceConnectionsStore.getRfidRuntimeStatus(profile.sessionId).lastError }}
                  </div>
                </q-card-section>
              </q-card>
            </div>

            <div class="device-settings-footer">
              <q-btn color="primary" no-caps unelevated @click="deviceConnectionsStore.addRfidProfile">
                新增 RFID 连接
              </q-btn>
            </div>
          </q-tab-panel>

          <q-tab-panel name="pad" class="device-settings-panel">
            <div class="device-settings-list">
              <q-card v-for="profile in padProfiles" :key="profile.id" flat bordered class="device-item-card">
                <q-card-section class="device-item-content">
                  <div class="device-item-grid">
                    <q-input v-model="profile.name" outlined label="设备名称" />
                    <q-input v-model.number="profile.sessionId" outlined type="number" min="0" label="Session ID" />

                    <q-select
                      v-model="profile.portPath"
                      outlined
                      emit-value
                      map-options
                      :options="serialOptions"
                      label="串口"
                      placeholder="选择串口"
                    />
                    <q-input
                      v-model.number="profile.baudRate"
                      outlined
                      type="number"
                      min="300"
                      step="300"
                      label="波特率"
                    />
                  </div>

                  <div class="device-item-actions">
                    <q-chip
                      square
                      dense
                      :color="deviceConnectionsStore.getPadRuntimeStatus(profile.sessionId).connected ? 'positive' : 'negative'"
                      text-color="white"
                    >
                      {{ deviceConnectionsStore.getPadRuntimeStatus(profile.sessionId).connected ? '已连接' : '未连接' }}
                    </q-chip>

                    <q-btn
                      outline
                      color="primary"
                      no-caps
                      :disable="activePadSessionId === profile.sessionId"
                      @click="deviceConnectionsStore.setActivePadSession(profile.sessionId)"
                    >
                      {{ activePadSessionId === profile.sessionId ? '当前会话' : '设为当前' }}
                    </q-btn>

                    <q-btn color="primary" no-caps unelevated @click="connectPadProfile(profile)">连接</q-btn>
                    <q-btn color="negative" no-caps unelevated @click="disconnectPadProfile(profile)">断开</q-btn>
                    <q-btn
                      flat
                      no-caps
                      color="negative"
                      :disable="padProfiles.length <= 1"
                      @click="deviceConnectionsStore.removePadProfile(profile.id)"
                    >
                      删除
                    </q-btn>
                  </div>

                  <div
                    v-if="deviceConnectionsStore.getPadRuntimeStatus(profile.sessionId).lastError"
                    class="device-item-error"
                  >
                    最近错误：{{ deviceConnectionsStore.getPadRuntimeStatus(profile.sessionId).lastError }}
                  </div>
                </q-card-section>
              </q-card>
            </div>

            <div class="device-settings-footer">
              <q-btn color="primary" no-caps unelevated @click="deviceConnectionsStore.addPadProfile">
                新增 PAD 连接
              </q-btn>
            </div>
          </q-tab-panel>
        </q-tab-panels>
      </q-card>
    </q-dialog>
  </q-layout>
</template>
<style scoped>
.app-layout {
  min-height: 100vh;
}

.app-header {
  background: color-mix(in srgb, var(--app-header) 92%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--app-border);
  color: var(--text-color);
}

.app-toolbar {
  gap: 16px;
  min-height: 68px;
  padding: 0 20px;
}

.nav-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.nav-btn {
  border-radius: 999px;
  font-weight: 500;
  min-height: 38px;
  padding: 0 8px;
}

.nav-btn--active {
  background: color-mix(in srgb, var(--app-surface) 70%, var(--bg-color));
}

.nav-menu {
  min-width: 180px;
}

.theme-toggle {
  background: color-mix(in srgb, var(--app-surface) 82%, transparent);
  border: 1px solid var(--app-border);
  border-radius: 999px;
  padding: 4px;
}

.app-page-container {
  background: var(--bg-color);
}

.app-content {
  margin: 0 auto;
  max-width: 1440px;
  padding: 18px;
  width: 100%;
}

.app-footer {
  background: var(--app-header);
  border-top: 1px solid var(--app-border);
  color: var(--app-text-secondary);
}

.app-footer__inner {
  padding: 14px 18px;
  text-align: center;
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
  justify-content: space-between;
  gap: 12px;
}

.device-settings-title {
  font-size: 18px;
  font-weight: 600;
}

.device-settings-actions {
  align-items: center;
  display: flex;
  gap: 8px;
}

.device-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.device-settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.device-item-card {
  border-color: var(--app-border);
  border-radius: 14px;
}

.device-item-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.device-item-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.device-item-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.device-item-error {
  color: rgb(220, 38, 38);
}

.device-settings-footer {
  display: flex;
  justify-content: flex-start;
}

@media (max-width: 1200px) {
  .device-item-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .app-toolbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 14px 16px;
  }

  .nav-group {
    width: 100%;
  }

  .theme-toggle {
    width: 100%;
  }

  .device-settings-header,
  .device-settings-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .device-item-grid {
    grid-template-columns: 1fr;
  }
}
</style>

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Notify } from 'quasar'
import {
  useDeviceConnectionsStore,
  type LockConnectionProfile,
  type RfidConnectionProfile
} from '../stores/deviceConnections'
import { guoxinSingleDevice } from '../components/rfid/guoxin/GuoXinDevice'
import { lockDevice } from '../components/lock/LockDevice'

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

export function useDeviceConnectionsManager() {
  const deviceConnectionsStore = useDeviceConnectionsStore()
  const {
    rfidProfiles,
    lockProfiles,
    activeRfidSessionId,
    activeLockSessionId,
    rfidRuntimeMap,
    lockRuntimeMap
  } = storeToRefs(deviceConnectionsStore)

  const loadingSerialOptions = ref(false)
  const serialOptions = ref<{ label: string; value: string }[]>([{ label: '请选择串口', value: '' }])

  const connectedRfidCount = computed(
    () => Object.values(rfidRuntimeMap.value).filter((item) => item.connected).length
  )
  const connectedLockCount = computed(
    () => Object.values(lockRuntimeMap.value).filter((item) => item.connected).length
  )

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

  const connectLockProfile = async (profile: LockConnectionProfile) => {
    try {
      const sessionId = requireSessionId(profile.sessionId, 'Lock 会话 ID')
      ensureUniqueSession(sessionId, lockProfiles.value, profile.id, 'Lock')

      if (!profile.portPath) {
        throw new Error('请先选择 Lock 串口')
      }

      await lockDevice.connectSerial({
        sessionId,
        path: profile.portPath,
        baudRate: Number(profile.baudRate) || 9600
      })

      deviceConnectionsStore.setActiveLockSession(sessionId)

      Notify.create({
        type: 'positive',
        message: `Lock 会话[${sessionId}]连接成功`,
        position: 'top-right',
        timeout: 2200
      })
    } catch (error) {
      Notify.create({
        type: 'negative',
        message: `Lock 连接失败: ${resolveError(error)}`,
        position: 'top-right',
        timeout: 2200
      })
    }
  }

  const disconnectLockProfile = async (profile: LockConnectionProfile) => {
    try {
      const sessionId = requireSessionId(profile.sessionId, 'Lock 会话 ID')
      await lockDevice.disconnect(sessionId)

      Notify.create({
        type: 'positive',
        message: `Lock 会话[${sessionId}]已断开`,
        position: 'top-right',
        timeout: 2200
      })
    } catch (error) {
      Notify.create({
        type: 'negative',
        message: `Lock 断开失败: ${resolveError(error)}`,
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
    activeLockSessionId,
    (sessionId) => {
      lockDevice.setActiveSession(sessionId)
    },
    { immediate: true }
  )

  let disposeRfidStatus = () => {}
  let disposeLockStatus = () => {}

  onMounted(() => {
    void refreshSerialOptions()

    disposeRfidStatus = guoxinSingleDevice.subscribeStatus((snapshot) => {
      deviceConnectionsStore.updateRfidRuntimeStatus(snapshot)
    })

    disposeLockStatus = lockDevice.subscribeStatus((snapshot) => {
      deviceConnectionsStore.updateLockRuntimeStatus(snapshot)
    })
  })

  onUnmounted(() => {
    disposeRfidStatus()
    disposeLockStatus()
  })

  return {
    deviceConnectionsStore,
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
    getRfidRuntimeStatus: deviceConnectionsStore.getRfidRuntimeStatus,
    getLockRuntimeStatus: deviceConnectionsStore.getLockRuntimeStatus,
    setActiveRfidSession: deviceConnectionsStore.setActiveRfidSession,
    setActiveLockSession: deviceConnectionsStore.setActiveLockSession,
    addRfidProfile: deviceConnectionsStore.addRfidProfile,
    removeRfidProfile: deviceConnectionsStore.removeRfidProfile,
    addLockProfile: deviceConnectionsStore.addLockProfile,
    removeLockProfile: deviceConnectionsStore.removeLockProfile
  }
}

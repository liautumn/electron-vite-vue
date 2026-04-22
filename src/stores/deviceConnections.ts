import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { GuoxinConnectionMode, GuoxinDeviceSnapshot } from '../components/rfid/guoxin/GuoXinDevice'
import type { LockDeviceSnapshot } from '../components/lock/LockDevice'

export type RfidConnectionProfile = {
  id: string
  name: string
  sessionId: number
  mode: GuoxinConnectionMode
  portPath: string
  baudRate: number
  host: string
  tcpPort: number
  antennaCount: number
}

export type LockConnectionProfile = {
  id: string
  name: string
  sessionId: number
  portPath: string
  baudRate: number
}

type RfidRuntimeStatus = {
  connected: boolean
  mode: GuoxinConnectionMode
  lastError: string | null
}

type LockRuntimeStatus = {
  connected: boolean
  lastError: string | null
}

const DEFAULT_RFID_SESSION_ID = 0
const DEFAULT_LOCK_SESSION_ID = 0

function normalizeSessionId(value: number, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback
  }
  return parsed
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function createDefaultRfidProfile(sessionId = DEFAULT_RFID_SESSION_ID): RfidConnectionProfile {
  return {
    id: createId('rfid'),
    name: `RFID-${sessionId}`,
    sessionId,
    mode: 'tcp',
    portPath: '',
    baudRate: 9600,
    host: '192.168.1.168',
    tcpPort: 8160,
    antennaCount: 4
  }
}

function createDefaultLockProfile(sessionId = DEFAULT_LOCK_SESSION_ID): LockConnectionProfile {
  return {
    id: createId('lock'),
    name: `Lock-${sessionId}`,
    sessionId,
    portPath: '',
    baudRate: 9600
  }
}

export const useDeviceConnectionsStore = defineStore(
  'device-connections',
  () => {
    const rfidProfiles = ref<RfidConnectionProfile[]>([createDefaultRfidProfile(DEFAULT_RFID_SESSION_ID)])
    const lockProfiles = ref<LockConnectionProfile[]>([createDefaultLockProfile(DEFAULT_LOCK_SESSION_ID)])

    const activeRfidSessionId = ref(DEFAULT_RFID_SESSION_ID)
    const activeLockSessionId = ref(DEFAULT_LOCK_SESSION_ID)

    const rfidRuntimeMap = ref<Record<number, RfidRuntimeStatus>>({})
    const lockRuntimeMap = ref<Record<number, LockRuntimeStatus>>({})

    const rfidSessionOptions = computed(() =>
      rfidProfiles.value
        .map((item) => ({
          label: `${item.name} (Session ${item.sessionId})`,
          value: item.sessionId
        }))
        .sort((a, b) => a.value - b.value)
    )

    const lockSessionOptions = computed(() =>
      lockProfiles.value
        .map((item) => ({
          label: `${item.name} (Session ${item.sessionId})`,
          value: item.sessionId
        }))
        .sort((a, b) => a.value - b.value)
    )

    const setActiveRfidSession = (sessionId: number) => {
      activeRfidSessionId.value = normalizeSessionId(sessionId, DEFAULT_RFID_SESSION_ID)
    }

    const setActiveLockSession = (sessionId: number) => {
      activeLockSessionId.value = normalizeSessionId(sessionId, DEFAULT_LOCK_SESSION_ID)
    }

    const addRfidProfile = () => {
      const nextSessionId =
        Math.max(-1, ...rfidProfiles.value.map((item) => normalizeSessionId(item.sessionId, 0))) + 1
      const profile = createDefaultRfidProfile(nextSessionId)
      rfidProfiles.value.push(profile)
      return profile
    }

    const removeRfidProfile = (id: string) => {
      const index = rfidProfiles.value.findIndex((item) => item.id === id)
      if (index === -1) {
        return
      }

      const [removed] = rfidProfiles.value.splice(index, 1)
      if (!rfidProfiles.value.length) {
        rfidProfiles.value.push(createDefaultRfidProfile(DEFAULT_RFID_SESSION_ID))
      }

      if (removed?.sessionId === activeRfidSessionId.value) {
        setActiveRfidSession(rfidProfiles.value[0]?.sessionId ?? DEFAULT_RFID_SESSION_ID)
      }
    }

    const addLockProfile = () => {
      const nextSessionId =
        Math.max(-1, ...lockProfiles.value.map((item) => normalizeSessionId(item.sessionId, 0))) + 1
      const profile = createDefaultLockProfile(nextSessionId)
      lockProfiles.value.push(profile)
      return profile
    }

    const removeLockProfile = (id: string) => {
      const index = lockProfiles.value.findIndex((item) => item.id === id)
      if (index === -1) {
        return
      }

      const [removed] = lockProfiles.value.splice(index, 1)
      if (!lockProfiles.value.length) {
        lockProfiles.value.push(createDefaultLockProfile(DEFAULT_LOCK_SESSION_ID))
      }

      if (removed?.sessionId === activeLockSessionId.value) {
        setActiveLockSession(lockProfiles.value[0]?.sessionId ?? DEFAULT_LOCK_SESSION_ID)
      }
    }

    const updateRfidRuntimeStatus = (snapshot: GuoxinDeviceSnapshot) => {
      const sessionId = normalizeSessionId(snapshot.sessionId, DEFAULT_RFID_SESSION_ID)
      rfidRuntimeMap.value = {
        ...rfidRuntimeMap.value,
        [sessionId]: {
          connected: snapshot.connected,
          mode: snapshot.mode,
          lastError: snapshot.lastError
        }
      }
    }

    const updateLockRuntimeStatus = (snapshot: LockDeviceSnapshot) => {
      const sessionId = normalizeSessionId(snapshot.sessionId, DEFAULT_LOCK_SESSION_ID)
      lockRuntimeMap.value = {
        ...lockRuntimeMap.value,
        [sessionId]: {
          connected: snapshot.connected,
          lastError: snapshot.lastError
        }
      }
    }

    const getRfidRuntimeStatus = (sessionId: number): RfidRuntimeStatus => {
      const targetSessionId = normalizeSessionId(sessionId, DEFAULT_RFID_SESSION_ID)
      return (
        rfidRuntimeMap.value[targetSessionId] ?? {
          connected: false,
          mode: 'tcp',
          lastError: null
        }
      )
    }

    const getLockRuntimeStatus = (sessionId: number): LockRuntimeStatus => {
      const targetSessionId = normalizeSessionId(sessionId, DEFAULT_LOCK_SESSION_ID)
      return (
        lockRuntimeMap.value[targetSessionId] ?? {
          connected: false,
          lastError: null
        }
      )
    }

    return {
      rfidProfiles,
      lockProfiles,
      activeRfidSessionId,
      activeLockSessionId,
      rfidRuntimeMap,
      lockRuntimeMap,
      rfidSessionOptions,
      lockSessionOptions,
      setActiveRfidSession,
      setActiveLockSession,
      addRfidProfile,
      removeRfidProfile,
      addLockProfile,
      removeLockProfile,
      updateRfidRuntimeStatus,
      updateLockRuntimeStatus,
      getRfidRuntimeStatus,
      getLockRuntimeStatus
    }
  },
  {
    persist: {
      key: 'device-connections-store',
      storage: localStorage,
      pick: ['rfidProfiles', 'lockProfiles', 'activeRfidSessionId', 'activeLockSessionId']
    }
  }
)

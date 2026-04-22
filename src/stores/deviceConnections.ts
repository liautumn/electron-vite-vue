import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  TransportConnectionMode,
  TransportConnectionProfile,
  TransportSessionSnapshot
} from '../components/transport/TransportSessionHub'

export type DeviceConnectionProfile = TransportConnectionProfile

export type DeviceConnectionRuntimeStatus = {
  connected: boolean
  mode: TransportConnectionMode
  lastError: string | null
}

const DEFAULT_SESSION_ID = 0

function normalizeSessionId(value: number, fallback = DEFAULT_SESSION_ID) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback
  }
  return parsed
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function createDefaultProfile(
  mode: TransportConnectionMode,
  sessionId = DEFAULT_SESSION_ID
): DeviceConnectionProfile {
  if (mode === 'serial') {
    return {
      id: createId('serial'),
      name: `Serial-${sessionId}`,
      sessionId,
      mode,
      portPath: '',
      baudRate: 9600
    }
  }

  return {
    id: createId('tcp'),
    name: `TCP-${sessionId}`,
    sessionId,
    mode,
    host: '192.168.1.168',
    port: 8160
  }
}

export const useDeviceConnectionsStore = defineStore(
  'device-connections',
  () => {
    const connectionProfiles = ref<DeviceConnectionProfile[]>([
      createDefaultProfile('tcp', DEFAULT_SESSION_ID)
    ])

    const activeRfidSessionId = ref(DEFAULT_SESSION_ID)
    const activeLockSessionId = ref(DEFAULT_SESSION_ID)
    const activeLedSessionId = ref(DEFAULT_SESSION_ID)

    const runtimeMap = ref<Record<number, DeviceConnectionRuntimeStatus>>({})

    const connectionSessionOptions = computed(() =>
      connectionProfiles.value
        .map((item) => ({
          label: `${item.name} (Session ${item.sessionId})`,
          value: item.sessionId
        }))
        .sort((a, b) => a.value - b.value)
    )

    const setActiveRfidSession = (sessionId: number) => {
      activeRfidSessionId.value = normalizeSessionId(sessionId)
    }

    const setActiveLockSession = (sessionId: number) => {
      activeLockSessionId.value = normalizeSessionId(sessionId)
    }

    const setActiveLedSession = (sessionId: number) => {
      activeLedSessionId.value = normalizeSessionId(sessionId)
    }

    const addConnectionProfile = (mode: TransportConnectionMode) => {
      const nextSessionId =
        Math.max(-1, ...connectionProfiles.value.map((item) => normalizeSessionId(item.sessionId, 0))) + 1

      const profile = createDefaultProfile(mode, nextSessionId)
      connectionProfiles.value.push(profile)
      return profile
    }

    const removeConnectionProfile = (id: string) => {
      const index = connectionProfiles.value.findIndex((item) => item.id === id)
      if (index === -1) {
        return
      }

      const [removed] = connectionProfiles.value.splice(index, 1)

      if (!connectionProfiles.value.length) {
        connectionProfiles.value.push(createDefaultProfile('tcp', DEFAULT_SESSION_ID))
      }

      const fallbackSessionId = connectionProfiles.value[0]?.sessionId ?? DEFAULT_SESSION_ID

      if (removed?.sessionId === activeRfidSessionId.value) {
        setActiveRfidSession(fallbackSessionId)
      }
      if (removed?.sessionId === activeLockSessionId.value) {
        setActiveLockSession(fallbackSessionId)
      }
      if (removed?.sessionId === activeLedSessionId.value) {
        setActiveLedSession(fallbackSessionId)
      }
    }

    const updateRuntimeStatus = (snapshot: TransportSessionSnapshot) => {
      const sessionId = normalizeSessionId(snapshot.sessionId)
      runtimeMap.value = {
        ...runtimeMap.value,
        [sessionId]: {
          connected: snapshot.connected,
          mode: snapshot.mode,
          lastError: snapshot.lastError
        }
      }
    }

    const getRuntimeStatus = (sessionId: number): DeviceConnectionRuntimeStatus => {
      const targetSessionId = normalizeSessionId(sessionId)
      return (
        runtimeMap.value[targetSessionId] ?? {
          connected: false,
          mode: 'tcp',
          lastError: null
        }
      )
    }

    const getProfileBySessionId = (sessionId: number) => {
      const targetSessionId = normalizeSessionId(sessionId)
      return connectionProfiles.value.find((item) => item.sessionId === targetSessionId) ?? null
    }

    return {
      connectionProfiles,
      activeRfidSessionId,
      activeLockSessionId,
      activeLedSessionId,
      runtimeMap,
      connectionSessionOptions,
      setActiveRfidSession,
      setActiveLockSession,
      setActiveLedSession,
      addConnectionProfile,
      removeConnectionProfile,
      updateRuntimeStatus,
      getRuntimeStatus,
      getProfileBySessionId
    }
  },
  {
    persist: {
      key: 'device-connections-store',
      storage: localStorage,
      pick: [
        'connectionProfiles',
        'activeRfidSessionId',
        'activeLockSessionId',
        'activeLedSessionId'
      ]
    }
  }
)

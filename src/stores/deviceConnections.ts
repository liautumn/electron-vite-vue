import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { GuoxinConnectionMode, GuoxinDeviceSnapshot } from '../components/rfid/guoxin/GuoXinSingleDevice'
import type { PadDeviceSnapshot } from '../components/pad/PadSingleDevice'

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

export type PadConnectionProfile = {
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

type PadRuntimeStatus = {
  connected: boolean
  lastError: string | null
}

const DEFAULT_RFID_SESSION_ID = 0
const DEFAULT_PAD_SESSION_ID = 0

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

function createDefaultPadProfile(sessionId = DEFAULT_PAD_SESSION_ID): PadConnectionProfile {
  return {
    id: createId('pad'),
    name: `PAD-${sessionId}`,
    sessionId,
    portPath: '',
    baudRate: 9600
  }
}

export const useDeviceConnectionsStore = defineStore(
  'device-connections',
  () => {
    const rfidProfiles = ref<RfidConnectionProfile[]>([createDefaultRfidProfile(DEFAULT_RFID_SESSION_ID)])
    const padProfiles = ref<PadConnectionProfile[]>([createDefaultPadProfile(DEFAULT_PAD_SESSION_ID)])

    const activeRfidSessionId = ref(DEFAULT_RFID_SESSION_ID)
    const activePadSessionId = ref(DEFAULT_PAD_SESSION_ID)

    const rfidRuntimeMap = ref<Record<number, RfidRuntimeStatus>>({})
    const padRuntimeMap = ref<Record<number, PadRuntimeStatus>>({})

    const rfidSessionOptions = computed(() =>
      rfidProfiles.value
        .map((item) => ({
          label: `${item.name} (Session ${item.sessionId})`,
          value: item.sessionId
        }))
        .sort((a, b) => a.value - b.value)
    )

    const padSessionOptions = computed(() =>
      padProfiles.value
        .map((item) => ({
          label: `${item.name} (Session ${item.sessionId})`,
          value: item.sessionId
        }))
        .sort((a, b) => a.value - b.value)
    )

    const setActiveRfidSession = (sessionId: number) => {
      activeRfidSessionId.value = normalizeSessionId(sessionId, DEFAULT_RFID_SESSION_ID)
    }

    const setActivePadSession = (sessionId: number) => {
      activePadSessionId.value = normalizeSessionId(sessionId, DEFAULT_PAD_SESSION_ID)
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

    const addPadProfile = () => {
      const nextSessionId =
        Math.max(-1, ...padProfiles.value.map((item) => normalizeSessionId(item.sessionId, 0))) + 1
      const profile = createDefaultPadProfile(nextSessionId)
      padProfiles.value.push(profile)
      return profile
    }

    const removePadProfile = (id: string) => {
      const index = padProfiles.value.findIndex((item) => item.id === id)
      if (index === -1) {
        return
      }

      const [removed] = padProfiles.value.splice(index, 1)
      if (!padProfiles.value.length) {
        padProfiles.value.push(createDefaultPadProfile(DEFAULT_PAD_SESSION_ID))
      }

      if (removed?.sessionId === activePadSessionId.value) {
        setActivePadSession(padProfiles.value[0]?.sessionId ?? DEFAULT_PAD_SESSION_ID)
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

    const updatePadRuntimeStatus = (snapshot: PadDeviceSnapshot) => {
      const sessionId = normalizeSessionId(snapshot.sessionId, DEFAULT_PAD_SESSION_ID)
      padRuntimeMap.value = {
        ...padRuntimeMap.value,
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

    const getPadRuntimeStatus = (sessionId: number): PadRuntimeStatus => {
      const targetSessionId = normalizeSessionId(sessionId, DEFAULT_PAD_SESSION_ID)
      return (
        padRuntimeMap.value[targetSessionId] ?? {
          connected: false,
          lastError: null
        }
      )
    }

    return {
      rfidProfiles,
      padProfiles,
      activeRfidSessionId,
      activePadSessionId,
      rfidRuntimeMap,
      padRuntimeMap,
      rfidSessionOptions,
      padSessionOptions,
      setActiveRfidSession,
      setActivePadSession,
      addRfidProfile,
      removeRfidProfile,
      addPadProfile,
      removePadProfile,
      updateRfidRuntimeStatus,
      updatePadRuntimeStatus,
      getRfidRuntimeStatus,
      getPadRuntimeStatus
    }
  },
  {
    persist: {
      key: 'device-connections-store',
      storage: localStorage,
      pick: ['rfidProfiles', 'padProfiles', 'activeRfidSessionId', 'activePadSessionId']
    }
  }
)

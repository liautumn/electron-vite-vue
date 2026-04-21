import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { GuoxinConnectionMode } from '../components/rfid/guoxin/GuoXinSingleDevice'

const MIN_ANTENNA_COUNT = 1
const MAX_ANTENNA_COUNT = 32
const MIN_POWER = 0
const MAX_POWER = 33
const MIN_SESSION_ID = 0
const MAX_SESSION_ID = Number.MAX_SAFE_INTEGER

export type GuoxinRfidConfig = {
  mode: GuoxinConnectionMode
  connectionSessionId: number
  portPath: string
  baudRate: number
  host: string
  tcpPort: number
  antennaCount: number
  antsInput: string
  powerLevels: number[]
  epcBasebandRate: number
  defaultQ: number
  session: number
  inventoryFlag: number
  writeAntenna: number
  writeTid: string
  writeEpc: string
  accessPassword: string
  oldAccessPassword: string
  killPassword: string
  rawHex: string
}

type LegacyGuoxinRfidConfig = Partial<GuoxinRfidConfig> & {
  readWriteIndex?: number
  readWritePower?: number
  otherPower?: number
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function createDefaultPowerLevels(antennaCount: number): number[] {
  return Array.from({ length: antennaCount }, (_, index) => (index === 0 ? 30 : 15))
}

function buildLegacyPowerLevels(input: LegacyGuoxinRfidConfig, antennaCount: number): number[] {
  const otherPower = clampInteger(input.otherPower, 15, MIN_POWER, MAX_POWER)
  const readWritePower = clampInteger(input.readWritePower, 30, MIN_POWER, MAX_POWER)
  const readWriteIndex = clampInteger(
    input.readWriteIndex,
    1,
    MIN_ANTENNA_COUNT,
    antennaCount
  )

  return Array.from({ length: antennaCount }, (_, index) =>
    index + 1 === readWriteIndex ? readWritePower : otherPower
  )
}

function normalizePowerLevels(
  powerLevels: unknown,
  antennaCount: number,
  fallbackLevels = createDefaultPowerLevels(antennaCount)
): number[] {
  return Array.from({ length: antennaCount }, (_, index) => {
    const fallback =
      fallbackLevels[index] ?? fallbackLevels[fallbackLevels.length - 1] ?? MIN_POWER
    const nextValue = Array.isArray(powerLevels) ? powerLevels[index] : undefined
    return clampInteger(nextValue, fallback, MIN_POWER, MAX_POWER)
  })
}

function createDefaultConfig(): GuoxinRfidConfig {
  return {
    mode: 'tcp',
    connectionSessionId: 0,
    portPath: '',
    baudRate: 9600,
    host: '192.168.1.168',
    tcpPort: 8160,
    antennaCount: 4,
    antsInput: '1',
    powerLevels: createDefaultPowerLevels(4),
    epcBasebandRate: 0x01,
    defaultQ: 0x04,
    session: 0x02,
    inventoryFlag: 0x00,
    writeAntenna: 1,
    writeTid: '',
    writeEpc: '',
    accessPassword: '00000000',
    oldAccessPassword: '00000000',
    killPassword: '00000000',
    rawHex: ''
  }
}

function normalizeConfig(input: LegacyGuoxinRfidConfig = {}): GuoxinRfidConfig {
  const defaults = createDefaultConfig()
  const antennaCount = clampInteger(
    input.antennaCount,
    defaults.antennaCount,
    MIN_ANTENNA_COUNT,
    MAX_ANTENNA_COUNT
  )

  const powerLevels = Array.isArray(input.powerLevels)
    ? normalizePowerLevels(input.powerLevels, antennaCount, defaults.powerLevels)
    : 'readWriteIndex' in input || 'readWritePower' in input || 'otherPower' in input
      ? buildLegacyPowerLevels(input, antennaCount)
      : normalizePowerLevels(defaults.powerLevels, antennaCount, defaults.powerLevels)

  const {
    powerLevels: _powerLevels,
    readWriteIndex: _readWriteIndex,
    readWritePower: _readWritePower,
    otherPower: _otherPower,
    ...rest
  } = input

  return {
    ...defaults,
    ...rest,
    connectionSessionId: clampInteger(
      rest.connectionSessionId,
      defaults.connectionSessionId,
      MIN_SESSION_ID,
      MAX_SESSION_ID
    ),
    antennaCount,
    powerLevels,
    writeAntenna: clampInteger(
      rest.writeAntenna,
      defaults.writeAntenna,
      MIN_ANTENNA_COUNT,
      antennaCount
    )
  }
}

export const useGuoxinRfidStore = defineStore(
  'guoxin-rfid',
  () => {
    const config = ref<GuoxinRfidConfig>(normalizeConfig())

    const getConfig = computed(() => config.value)

    function setConfig(nextConfig: Partial<GuoxinRfidConfig>) {
      config.value = normalizeConfig({
        ...config.value,
        ...nextConfig
      })
    }

    function replaceConfig(nextConfig: GuoxinRfidConfig) {
      config.value = normalizeConfig(nextConfig)
    }

    function resetConfig() {
      config.value = normalizeConfig()
    }

    return {
      config,
      getConfig,
      setConfig,
      replaceConfig,
      resetConfig
    }
  },
  {
    persist: {
      key: 'guoxin-rfid-store',
      storage: localStorage,
      afterHydrate: (context) => {
        const store = context.store as typeof context.store & {
          config: LegacyGuoxinRfidConfig
        }
        store.config = normalizeConfig(store.config)
        store.$persist()
      }
    }
  }
)

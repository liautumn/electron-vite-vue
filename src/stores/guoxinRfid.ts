import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { GuoxinConnectionMode } from '../components/rfid/guoxin/GuoXinDevice'

const MIN_ANTENNA_COUNT = 1
const MAX_ANTENNA_COUNT = 32
const MIN_POWER = 0
const MAX_POWER = 33
const MIN_SESSION_ID = 0
const MAX_SESSION_ID = Number.MAX_SAFE_INTEGER

export type GuoxinRfidConfig = {
  mode: GuoxinConnectionMode
  connectionSessionId: number
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

  return {
    ...defaults,
    mode: input.mode ?? defaults.mode,
    connectionSessionId: clampInteger(
      input.connectionSessionId,
      defaults.connectionSessionId,
      MIN_SESSION_ID,
      MAX_SESSION_ID
    ),
    antennaCount,
    antsInput: input.antsInput ?? defaults.antsInput,
    powerLevels,
    epcBasebandRate: input.epcBasebandRate ?? defaults.epcBasebandRate,
    defaultQ: input.defaultQ ?? defaults.defaultQ,
    session: input.session ?? defaults.session,
    inventoryFlag: input.inventoryFlag ?? defaults.inventoryFlag,
    writeAntenna: clampInteger(
      input.writeAntenna,
      defaults.writeAntenna,
      MIN_ANTENNA_COUNT,
      antennaCount
    ),
    writeTid: input.writeTid ?? defaults.writeTid,
    writeEpc: input.writeEpc ?? defaults.writeEpc,
    accessPassword: input.accessPassword ?? defaults.accessPassword,
    oldAccessPassword: input.oldAccessPassword ?? defaults.oldAccessPassword,
    killPassword: input.killPassword ?? defaults.killPassword,
    rawHex: input.rawHex ?? defaults.rawHex
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

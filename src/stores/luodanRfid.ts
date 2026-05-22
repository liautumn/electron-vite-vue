import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LuodanConnectionMode } from '../components/rfid/luodan/LuodanDevice'

const MIN_SESSION_ID = 0
const MAX_SESSION_ID = Number.MAX_SAFE_INTEGER
const MAX_ANTENNA_COUNT = 16

export type LuodanRfidConfig = {
  mode: LuodanConnectionMode
  connectionSessionId: number
  readerAddress: number
  antennaCount: number
  powerAntennaId: number
  permanentPowerDbm: number
  powerLevels: number[]
  beeperMode: number
  movementDirectionReversed: boolean
  inventorySession: number
  target: number
  sl: number
  repeat: number
  carrierFrequencyMHz: number
  rawHex: string
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function createDefaultPowerLevels(antennaCount: number) {
  return Array.from({ length: antennaCount }, () => 30)
}

function normalizePowerLevels(
  powerLevels: unknown,
  antennaCount: number,
  fallbackLevels = createDefaultPowerLevels(antennaCount)
) {
  return Array.from({ length: antennaCount }, (_, index) =>
    clampInteger(
      Array.isArray(powerLevels) ? powerLevels[index] : undefined,
      fallbackLevels[index] ?? 30,
      0,
      33
    )
  )
}

function createDefaultConfig(): LuodanRfidConfig {
  return {
    mode: 'tcp',
    connectionSessionId: 0,
    readerAddress: 0xff,
    antennaCount: 4,
    powerAntennaId: 1,
    permanentPowerDbm: 30,
    powerLevels: createDefaultPowerLevels(4),
    beeperMode: 0,
    movementDirectionReversed: false,
    inventorySession: 0x01,
    target: 0x00,
    sl: 0x00,
    repeat: 0x01,
    carrierFrequencyMHz: 915,
    rawHex: ''
  }
}

function normalizeConfig(input: Partial<LuodanRfidConfig> = {}): LuodanRfidConfig {
  const defaults = createDefaultConfig()
  const antennaCount = clampInteger(input.antennaCount, defaults.antennaCount, 1, MAX_ANTENNA_COUNT)
  const powerLevels = normalizePowerLevels(input.powerLevels, antennaCount, defaults.powerLevels)

  return {
    ...defaults,
    mode: input.mode ?? defaults.mode,
    connectionSessionId: clampInteger(
      input.connectionSessionId,
      defaults.connectionSessionId,
      MIN_SESSION_ID,
      MAX_SESSION_ID
    ),
    readerAddress: clampInteger(input.readerAddress, defaults.readerAddress, 0, 0xff),
    antennaCount,
    powerAntennaId: clampInteger(input.powerAntennaId, defaults.powerAntennaId, 1, antennaCount),
    permanentPowerDbm: clampInteger(input.permanentPowerDbm, defaults.permanentPowerDbm, 0, 33),
    powerLevels,
    beeperMode: clampInteger(input.beeperMode, defaults.beeperMode, 0, 2),
    movementDirectionReversed: input.movementDirectionReversed === true,
    inventorySession: clampInteger(input.inventorySession, defaults.inventorySession, 0, 3),
    target: clampInteger(input.target, defaults.target, 0, 1),
    sl: clampInteger(input.sl, defaults.sl, 0, 3),
    repeat: clampInteger(input.repeat, defaults.repeat, 0, 0xff),
    carrierFrequencyMHz: clampInteger(
      input.carrierFrequencyMHz,
      defaults.carrierFrequencyMHz,
      1,
      10_000
    ),
    rawHex: input.rawHex ?? defaults.rawHex
  }
}

export const useLuodanRfidStore = defineStore(
  'luodan-rfid',
  () => {
    const config = ref<LuodanRfidConfig>(normalizeConfig())

    const getConfig = computed(() => config.value)

    function setConfig(nextConfig: Partial<LuodanRfidConfig>) {
      config.value = normalizeConfig({
        ...config.value,
        ...nextConfig
      })
    }

    function replaceConfig(nextConfig: LuodanRfidConfig) {
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
      key: 'luodan-rfid-store',
      storage: localStorage,
      afterHydrate: (context) => {
        const store = context.store as typeof context.store & {
          config: Partial<LuodanRfidConfig>
        }
        store.config = normalizeConfig(store.config)
        store.$persist()
      }
    }
  }
)

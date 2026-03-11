import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { GuoxinConnectionMode } from '../components/rfid/guoxin/GuoxinSingleDevice'

export type GuoxinRfidConfig = {
  mode: GuoxinConnectionMode
  portPath: string
  baudRate: number
  host: string
  tcpPort: number
  antennaCount: number
  antsInput: string
  readWriteIndex: number
  readWritePower: number
  otherPower: number
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

function createDefaultConfig(): GuoxinRfidConfig {
  return {
    mode: 'tcp',
    portPath: '',
    baudRate: 9600,
    host: '192.168.1.168',
    tcpPort: 8160,
    antennaCount: 4,
    antsInput: '1',
    readWriteIndex: 1,
    readWritePower: 30,
    otherPower: 15,
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

export const useGuoxinRfidStore = defineStore(
  'guoxin-rfid',
  () => {
    const config = ref<GuoxinRfidConfig>(createDefaultConfig())

    const getConfig = computed(() => config.value)

    function setConfig(nextConfig: Partial<GuoxinRfidConfig>) {
      config.value = {
        ...config.value,
        ...nextConfig
      }
    }

    function replaceConfig(nextConfig: GuoxinRfidConfig) {
      config.value = {
        ...nextConfig
      }
    }

    function resetConfig() {
      config.value = createDefaultConfig()
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
      storage: localStorage
    }
  }
)

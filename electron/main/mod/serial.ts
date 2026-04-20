import { SerialPort } from 'serialport'
import { BrowserWindow, ipcMain } from 'electron'
import {createLogger} from '../utils/logger'
import type { SerialOpenOptions } from '../../../shared/types/serial'

type SerialWriteRequest =
  | string
  | {
      sessionId?: number
      hex: string
    }

const DEFAULT_SERIAL_SESSION_ID = 0

let win: BrowserWindow | null = null
let serialRegistered = false
const ports = new Map<number, SerialPort>()
const log = createLogger('serial')

const resolveSessionId = (sessionId?: number) =>
  Number.isInteger(sessionId) ? Number(sessionId) : DEFAULT_SERIAL_SESSION_ID

const resolveWriteRequest = (request: SerialWriteRequest) => {
  if (typeof request === 'string') {
    return {
      sessionId: DEFAULT_SERIAL_SESSION_ID,
      hex: request
    }
  }

  return {
    sessionId: resolveSessionId(request?.sessionId),
    hex: request?.hex ?? ''
  }
}

const sendToRenderer = (channel: string, payload?: unknown) => {
  if (!win || win.isDestroyed()) return

  if (payload === undefined) {
    win.webContents.send(channel)
    return
  }

  win.webContents.send(channel, payload)
}

const closePort = async (sessionId: number, notifyClose = true) => {
  const activePort = ports.get(sessionId)
  if (!activePort) return false

  ports.delete(sessionId)

  try {
    if (activePort.isOpen) {
      await new Promise<void>((resolve, reject) => {
        activePort.close(error => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  } finally {
    activePort.removeAllListeners()
  }

  log.info('Serial port closed by IPC request', { sessionId })

  if (notifyClose) {
    sendToRenderer('serial:close', { sessionId })
  }

  return true
}

const bindPortEvents = (sessionId: number, options: SerialOpenOptions, target: SerialPort) => {
  target.on('open', () => {
    if (ports.get(sessionId) !== target) return

    log.info('Serial port opened', {
      sessionId,
      path: options.path,
      baudRate: options.baudRate,
    })
    sendToRenderer('serial:open', { sessionId })
  })

  target.on('data', (data: Buffer) => {
    if (ports.get(sessionId) !== target) return

    sendToRenderer('serial:data', {
      sessionId,
      data: data.toString('hex').toUpperCase()
    })
  })

  target.on('close', () => {
    if (ports.get(sessionId) !== target) return

    ports.delete(sessionId)
    log.info('Serial port closed', { sessionId, path: options.path })
    sendToRenderer('serial:close', { sessionId })
  })

  target.on('error', err => {
    if (ports.get(sessionId) !== target) return

    log.error('Serial port error', {
      sessionId,
      path: options.path,
      error: err,
    })
    sendToRenderer('serial:error', {
      sessionId,
      message: err.message
    })
  })
}

export function registerSerial(mainWindow: BrowserWindow) {
  win = mainWindow

  if (serialRegistered) return
  serialRegistered = true
  log.info('Serial IPC handlers registered')

  /* 获取串口列表 */
  ipcMain.handle('serial:list', async () => {
    return await SerialPort.list()
  })

  /* 打开串口 */
  ipcMain.handle('serial:open', async (_, options: SerialOpenOptions) => {
    const sessionId = resolveSessionId(options?.sessionId)

    log.info('Opening serial port', {
      sessionId,
      path: options.path,
      baudRate: options.baudRate,
    })

    await closePort(sessionId, true)

    const nextPort = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      autoOpen: true,
    })

    ports.set(sessionId, nextPort)
    bindPortEvents(sessionId, options, nextPort)

    return true
  })

  /* 关闭串口 */
  ipcMain.handle('serial:close', async (_, sessionId?: number) => {
    log.info('Closing serial port', { sessionId: resolveSessionId(sessionId) })
    return await closePort(resolveSessionId(sessionId), true)
  })

  /* 写数据 */
  ipcMain.handle('serial:write', (_, request: SerialWriteRequest) => {
    const { sessionId, hex } = resolveWriteRequest(request)
    const activePort = ports.get(sessionId)

    if (!activePort || !activePort.isOpen) return false

    log.debug('Writing serial data', {
      sessionId,
      size: hex.length / 2
    })
    const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex')
    activePort.write(buf)
    return true
  })
}

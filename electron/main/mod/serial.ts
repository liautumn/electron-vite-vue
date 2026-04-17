import { SerialPort } from 'serialport'
import { BrowserWindow, ipcMain } from 'electron'
import {createLogger} from '../utils/logger'

let port: SerialPort | null = null
let win: BrowserWindow | null = null
let serialRegistered = false
const log = createLogger('serial')

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
  ipcMain.handle('serial:open', async (_, options) => {
    log.info('Opening serial port', {
      path: options.path,
      baudRate: options.baudRate,
    })
    port?.close()

    port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      autoOpen: true,
    })

    port.on('open', () => {
      log.info('Serial port opened', { path: options.path })
      win?.webContents.send('serial:open')
    })

    port.on('data', (data: Buffer) => {
      win?.webContents.send(
        'serial:data',
        data.toString('hex').toUpperCase()
      )
    })

    port.on('close', () => {
      log.info('Serial port closed', { path: options.path })
      win?.webContents.send('serial:close')
    })

    port.on('error', err => {
      log.error('Serial port error', err)
      win?.webContents.send('serial:error', err.message)
    })

    return true
  })

  /* 关闭串口 */
  ipcMain.handle('serial:close', () => {
    log.info('Closing serial port')
    port?.close()
    port = null
  })

  /* 写数据 */
  ipcMain.handle('serial:write', (_, hex: string) => {
    if (!port || !port.isOpen) return false
    log.debug('Writing serial data', { size: hex.length / 2 })
    const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex')
    port.write(buf)
    return true
  })
}

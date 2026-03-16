import { SerialPort } from 'serialport'
import { BrowserWindow, ipcMain } from 'electron'

let port: SerialPort | null = null
let win: BrowserWindow | null = null
let serialRegistered = false

export function registerSerial(mainWindow: BrowserWindow) {
  win = mainWindow

  if (serialRegistered) return
  serialRegistered = true

  /* 获取串口列表 */
  ipcMain.handle('serial:list', async () => {
    return await SerialPort.list()
  })

  /* 打开串口 */
  ipcMain.handle('serial:open', async (_, options) => {
    port?.close()

    port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      autoOpen: true,
    })

    port.on('open', () => {
      win?.webContents.send('serial:open')
    })

    port.on('data', (data: Buffer) => {
      win?.webContents.send(
        'serial:data',
        data.toString('hex').toUpperCase()
      )
    })

    port.on('close', () => {
      win?.webContents.send('serial:close')
    })

    port.on('error', err => {
      win?.webContents.send('serial:error', err.message)
    })

    return true
  })

  /* 关闭串口 */
  ipcMain.handle('serial:close', () => {
    port?.close()
    port = null
  })

  /* 写数据 */
  ipcMain.handle('serial:write', (_, hex: string) => {
    if (!port || !port.isOpen) return false
    const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex')
    port.write(buf)
    return true
  })
}

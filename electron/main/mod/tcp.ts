import { BrowserWindow, ipcMain } from 'electron'
import net, { Socket } from 'node:net'
import {createLogger} from '../utils/logger'

let socket: Socket | null = null
let win: BrowserWindow | null = null
let tcpRegistered = false
const log = createLogger('tcp')

export function registerTcp(mainWindow: BrowserWindow) {
  win = mainWindow

  if (tcpRegistered) return
  tcpRegistered = true
  log.info('TCP IPC handlers registered')

  ipcMain.handle('tcp:connect', async (_, options: { host: string; port: number }) => {
    log.info('Connecting TCP socket', options)
    socket?.destroy()

    socket = new net.Socket()
    socket.setNoDelay(true)

    socket.on('connect', () => {
      log.info('TCP socket connected', options)
      win?.webContents.send('tcp:connect')
    })

    socket.on('data', (data: Buffer) => {
      win?.webContents.send('tcp:data', data.toString('hex').toUpperCase())
    })

    socket.on('close', () => {
      log.info('TCP socket closed', options)
      win?.webContents.send('tcp:close')
    })

    socket.on('error', (err: Error) => {
      log.error('TCP socket error', err)
      win?.webContents.send('tcp:error', err.message)
    })

    socket.connect(options.port, options.host)
    return true
  })

  ipcMain.handle('tcp:disconnect', () => {
    log.info('Disconnecting TCP socket')
    socket?.destroy()
    socket = null
  })

  ipcMain.handle('tcp:write', (_, hex: string) => {
    if (!socket || socket.destroyed) return false
    log.debug('Writing TCP data', { size: hex.length / 2 })
    const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex')
    socket.write(buf)
    return true
  })
}

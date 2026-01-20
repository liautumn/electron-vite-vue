import { BrowserWindow, ipcMain } from 'electron'
import net, { Socket } from 'node:net'

let socket: Socket | null = null
let win: BrowserWindow | null = null
let tcpRegistered = false

export function registerTcp(mainWindow: BrowserWindow) {
  win = mainWindow

  if (tcpRegistered) return
  tcpRegistered = true

  ipcMain.handle('tcp:connect', async (_, options: { host: string; port: number }) => {
    socket?.destroy()

    socket = new net.Socket()
    socket.setNoDelay(true)

    socket.on('connect', () => {
      win?.webContents.send('tcp:connect')
    })

    socket.on('data', (data: Buffer) => {
      win?.webContents.send('tcp:data', data.toString('hex').toUpperCase())
    })

    socket.on('close', () => {
      win?.webContents.send('tcp:close')
    })

    socket.on('error', (err: Error) => {
      win?.webContents.send('tcp:error', err.message)
    })

    socket.connect(options.port, options.host)
    return true
  })

  ipcMain.handle('tcp:disconnect', () => {
    socket?.destroy()
    socket = null
  })

  ipcMain.handle('tcp:write', (_, hex: string) => {
    if (!socket || socket.destroyed) return false
    const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex')
    socket.write(buf)
    return true
  })
}

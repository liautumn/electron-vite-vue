import { BrowserWindow, ipcMain } from 'electron'
import net, { Socket } from 'node:net'
import {createLogger} from '../utils/logger'
import type { TcpConnectOptions, TcpConnectRequest } from '../../../shared/types/tcp'

type TcpWriteRequest =
  | string
  | {
      sessionId?: number
      hex: string
    }

const DEFAULT_TCP_SESSION_ID = 0

let win: BrowserWindow | null = null
let tcpRegistered = false
const sockets = new Map<number, Socket>()
const log = createLogger('tcp')

const resolveSessionId = (sessionId?: number) =>
  Number.isInteger(sessionId) ? Number(sessionId) : DEFAULT_TCP_SESSION_ID

const resolveWriteRequest = (request: TcpWriteRequest) => {
  if (typeof request === 'string') {
    return {
      sessionId: DEFAULT_TCP_SESSION_ID,
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

const destroySocket = (sessionId: number, notifyClose = true) => {
  const activeSocket = sockets.get(sessionId)
  if (!activeSocket) return false

  sockets.delete(sessionId)
  activeSocket.removeAllListeners()
  activeSocket.destroy()

  log.info('TCP socket closed by IPC request', { sessionId })

  if (notifyClose) {
    sendToRenderer('tcp:close', { sessionId })
  }

  return true
}

const bindSocketEvents = (sessionId: number, options: TcpConnectOptions, target: Socket) => {
  target.on('connect', () => {
    if (sockets.get(sessionId) !== target) return

    log.info('TCP socket connected', {
      sessionId,
      host: options.host,
      port: options.port,
    })
    sendToRenderer('tcp:connect', { sessionId })
  })

  target.on('data', (data: Buffer) => {
    if (sockets.get(sessionId) !== target) return

    sendToRenderer('tcp:data', {
      sessionId,
      data: data.toString('hex').toUpperCase()
    })
  })

  target.on('close', () => {
    if (sockets.get(sessionId) !== target) return

    sockets.delete(sessionId)
    log.info('TCP socket closed', {
      sessionId,
      host: options.host,
      port: options.port,
    })
    sendToRenderer('tcp:close', { sessionId })
  })

  target.on('error', (err: Error) => {
    if (sockets.get(sessionId) !== target) return

    log.error('TCP socket error', {
      sessionId,
      host: options.host,
      port: options.port,
      error: err,
    })
    sendToRenderer('tcp:error', {
      sessionId,
      message: err.message
    })
  })
}

export function registerTcp(mainWindow: BrowserWindow) {
  win = mainWindow

  if (tcpRegistered) return
  tcpRegistered = true
  log.info('TCP IPC handlers registered')

  ipcMain.handle('tcp:connect', async (_, options: TcpConnectRequest) => {
    const sessionId = resolveSessionId(options?.sessionId)

    log.info('Connecting TCP socket', {
      sessionId,
      host: options.host,
      port: options.port,
    })

    destroySocket(sessionId, true)

    const nextSocket = new net.Socket()
    nextSocket.setNoDelay(true)
    sockets.set(sessionId, nextSocket)
    bindSocketEvents(sessionId, options, nextSocket)
    nextSocket.connect(options.port, options.host)

    return true
  })

  ipcMain.handle('tcp:disconnect', (_, sessionId?: number) => {
    log.info('Disconnecting TCP socket', { sessionId: resolveSessionId(sessionId) })
    return destroySocket(resolveSessionId(sessionId), true)
  })

  ipcMain.handle('tcp:write', (_, request: TcpWriteRequest) => {
    const { sessionId, hex } = resolveWriteRequest(request)
    const activeSocket = sockets.get(sessionId)

    if (!activeSocket || activeSocket.destroyed) return false

    log.debug('Writing TCP data', {
      sessionId,
      size: hex.length / 2
    })
    const buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex')
    activeSocket.write(buf)
    return true
  })
}

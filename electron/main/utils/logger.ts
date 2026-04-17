import {app} from 'electron'
import log from 'electron-log'
import path from 'node:path'

const formatLogDate = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
}

const resolvePackagedLogDirectory = () => {
    if (process.platform === 'linux' && process.env.APPIMAGE) {
        return path.join(path.dirname(process.env.APPIMAGE), 'logs')
    }

    return path.join(process.resourcesPath, 'logs')
}

const resolveLogDirectory = () => {
    if (app.isPackaged) {
        return resolvePackagedLogDirectory()
    }

    return path.join(process.cwd(), 'logs')
}

const resolveLogFilePath = (date = new Date()) =>
    path.join(resolveLogDirectory(), `${formatLogDate(date)}.log`)

log.transports.file.resolvePathFn = (_variables, message) =>
    resolveLogFilePath(message?.date instanceof Date ? message.date : new Date())
log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? 'info' : 'silly'

try {
    app.setAppLogsPath(resolveLogDirectory())
} catch {
    // ignore: Electron will fall back to the explicit file transport path above
}

log.initialize()

export const createLogger = (scope: string) => log.scope(scope)

export const getLogDirectory = () => resolveLogDirectory()

export const getLogFilePath = (date = new Date()) => resolveLogFilePath(date)

export const logger = {
    info: (...args: Parameters<typeof log.info>) => log.info(...args),
    error: (...args: Parameters<typeof log.error>) => log.error(...args),
    warn: (...args: Parameters<typeof log.warn>) => log.warn(...args),
    debug: (...args: Parameters<typeof log.debug>) => log.debug(...args),
}

export default logger

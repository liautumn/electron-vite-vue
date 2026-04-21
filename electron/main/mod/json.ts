import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createLogger, getLogDirectory } from '../utils/logger'
import type { JsonReadRequest, JsonWriteRequest } from '../../../shared/types/json'

const JSON_DIRECTORY = 'json'
const JSON_EXTENSION = '.json'

const log = createLogger('json')
let jsonRegistered = false

const resolvePackagedJsonDirectory = () =>
  path.join(path.dirname(getLogDirectory()), JSON_DIRECTORY)

const resolveJsonDirectory = () => {
  if (app.isPackaged) {
    return resolvePackagedJsonDirectory()
  }

  return path.join(process.cwd(), JSON_DIRECTORY)
}

const ensureJsonDirectory = () => {
  const directoryPath = resolveJsonDirectory()

  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true })
  }
}

const normalizeFileName = (fileName: string) => {
  const trimmedFileName = fileName?.trim()
  if (!trimmedFileName) throw new Error('JSON 文件名不能为空')

  const nextFileName = trimmedFileName.endsWith(JSON_EXTENSION)
    ? trimmedFileName
    : `${trimmedFileName}${JSON_EXTENSION}`

  if (path.isAbsolute(nextFileName)) {
    throw new Error('JSON 文件名不支持绝对路径')
  }

  const normalizedPath = path.normalize(nextFileName)

  if (normalizedPath.split(path.sep).includes('..')) {
    throw new Error('JSON 文件名不支持上级目录路径')
  }

  return normalizedPath
}

const resolveJsonPath = (fileName: string) =>
  path.join(resolveJsonDirectory(), normalizeFileName(fileName))

const ensureParentDirectory = (filePath: string) => {
  const parentDirectory = path.dirname(filePath)
  if (!existsSync(parentDirectory)) {
    mkdirSync(parentDirectory, { recursive: true })
  }
}

const readJson = <T>(request: JsonReadRequest<T>) => {
  const fileName = request?.fileName ?? ''
  const fallback = request?.fallback
  const filePath = resolveJsonPath(fileName)

  if (!existsSync(filePath)) {
    return fallback ?? null
  }

  const content = readFileSync(filePath, 'utf-8').trim()
  if (!content) {
    return fallback ?? null
  }

  return JSON.parse(content) as T
}

const writeJson = <T>(request: JsonWriteRequest<T>) => {
  if (request?.data === undefined) {
    throw new Error('JSON 数据不能为空')
  }

  ensureJsonDirectory()
  const filePath = resolveJsonPath(request?.fileName ?? '')
  ensureParentDirectory(filePath)

  const pretty = request?.pretty !== false
  const content = JSON.stringify(request.data, null, pretty ? 2 : 0)
  writeFileSync(filePath, `${content}\n`, 'utf-8')
  log.info('JSON saved', { filePath })

  return true
}

export const getJsonDirectory = () => resolveJsonDirectory()

export function registerJson() {
  ensureJsonDirectory()

  if (jsonRegistered) return
  jsonRegistered = true
  log.info('JSON IPC handlers registered', { jsonDirectory: resolveJsonDirectory() })

  ipcMain.handle('json:read', (_, request: JsonReadRequest) => {
    try {
      return readJson(request)
    } catch (error) {
      log.error('Failed to read JSON', {
        fileName: request?.fileName,
        error,
      })
      throw error
    }
  })

  ipcMain.handle('json:write', (_, request: JsonWriteRequest) => {
    try {
      return writeJson(request)
    } catch (error) {
      log.error('Failed to write JSON', {
        fileName: request?.fileName,
        error,
      })
      throw error
    }
  })

  ipcMain.handle('json:get-directory', () => resolveJsonDirectory())
}

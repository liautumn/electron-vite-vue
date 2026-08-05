import {BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent} from 'electron'
import {readdir, readFile, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type {
    ImageFileContent,
    ImageFileEntry,
    ImageSelectionMode,
    SaveJpegRequest,
} from '../../../shared/types/image-files'
import {createLogger} from '../utils/logger'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'])
const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,'
const MAX_IMAGE_FILE_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_PIXELS = 25_000_000
const log = createLogger('image-files')

let mainWindow: BrowserWindow | null = null
let registered = false
const selectedPaths = new Set<string>()

const assertAuthorizedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) {
        throw new Error('Not authorized to access image files')
    }
}

const collectDirectoryImages = async (directoryPath: string): Promise<string[]> => {
    const entries = await readdir(directoryPath, {withFileTypes: true})
    const files = await Promise.all(entries.map(async entry => {
        const entryPath = path.join(directoryPath, entry.name)
        if (entry.isDirectory()) return collectDirectoryImages(entryPath)
        return entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
            ? [entryPath]
            : []
    }))
    return files.flat()
}

const select = async (mode: ImageSelectionMode): Promise<ImageFileEntry[]> => {
    if (mode !== 'images' && mode !== 'directory') throw new Error('Invalid image selection mode')
    if (!mainWindow || mainWindow.isDestroyed()) return []

    const result = await dialog.showOpenDialog(mainWindow, mode === 'directory'
        ? {
            title: '选择图片目录',
            properties: ['openDirectory'],
        }
        : {
            title: '选择图片',
            properties: ['openFile', 'multiSelections'],
            filters: [{name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff']}],
        })
    if (result.canceled) return []

    const selected = mode === 'directory' && result.filePaths[0]
        ? await collectDirectoryImages(result.filePaths[0])
        : result.filePaths
    const paths = [...new Set(selected.map(imagePath => path.resolve(imagePath)))]
        .sort((left, right) => left.localeCompare(right, undefined, {numeric: true}))

    paths.forEach(imagePath => selectedPaths.add(imagePath))
    return paths.map(imagePath => ({
        path: imagePath,
        name: path.basename(imagePath),
    }))
}

const readSelected = async (imagePath: string): Promise<ImageFileContent> => {
    if (typeof imagePath !== 'string' || !imagePath.trim()) throw new Error('Invalid image path')
    const resolvedPath = path.resolve(imagePath)
    if (!selectedPaths.has(resolvedPath)) throw new Error('Image path was not selected by the user')

    const file = await stat(resolvedPath)
    if (!file.isFile() || file.size <= 0 || file.size > MAX_IMAGE_FILE_BYTES) {
        throw new Error('图片文件大小超过处理上限')
    }

    const encoded = await readFile(resolvedPath)
    const {data: preview, info} = await sharp(encoded, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
    })
        .rotate()
        .toColourspace('srgb')
        .jpeg({quality: 90})
        .toBuffer({resolveWithObject: true})

    return {
        path: resolvedPath,
        name: path.basename(resolvedPath),
        encoded: Uint8Array.from(encoded),
        previewUrl: `${JPEG_DATA_URL_PREFIX}${preview.toString('base64')}`,
        width: info.width,
        height: info.height,
    }
}

const decodeJpegDataUrl = (imageUrl: string) => {
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith(JPEG_DATA_URL_PREFIX)) {
        throw new Error('Invalid JPEG data URL')
    }

    const payload = imageUrl.slice(JPEG_DATA_URL_PREFIX.length)
    const maxPayloadLength = Math.ceil(MAX_IMAGE_FILE_BYTES * 4 / 3) + 4
    if (!payload || payload.length > maxPayloadLength
        || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
        throw new Error('Invalid JPEG base64 payload')
    }

    const image = Buffer.from(payload, 'base64')
    if (image.length < 3 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
        throw new Error('Data URL does not contain a JPEG image')
    }
    return image
}

const saveJpeg = async (request: SaveJpegRequest) => {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const image = decodeJpegDataUrl(request?.imageUrl)
    const requestedName = typeof request?.name === 'string' ? path.parse(request.name).name.trim() : ''
    const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存图片',
        defaultPath: `${requestedName || 'image-result'}.jpg`,
        filters: [{name: 'JPEG 图片', extensions: ['jpg', 'jpeg']}],
    })
    if (result.canceled || !result.filePath) return null

    await writeFile(result.filePath, image)
    return result.filePath
}

export function registerImageFiles(window: BrowserWindow) {
    if (mainWindow !== window) selectedPaths.clear()
    mainWindow = window
    if (registered) return

    registered = true
    log.info('Image files IPC handlers registered')

    ipcMain.handle('image-files:select', (event, mode: ImageSelectionMode) => {
        assertAuthorizedSender(event)
        return select(mode)
    })
    ipcMain.handle('image-files:read', (event, imagePath: string) => {
        assertAuthorizedSender(event)
        return readSelected(imagePath)
    })
    ipcMain.handle('image-files:save-jpeg', (event, request: SaveJpegRequest) => {
        assertAuthorizedSender(event)
        return saveJpeg(request)
    })
}

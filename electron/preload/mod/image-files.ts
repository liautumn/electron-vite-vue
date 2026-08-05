import {contextBridge, ipcRenderer} from 'electron'
import type {
    ImageFilesMethods,
    ImageSelectionMode,
    SaveJpegRequest,
} from '../../../shared/types/image-files'

export function registerImageFilesRenderer() {
    contextBridge.exposeInMainWorld('imageFiles', {
        select: (mode: ImageSelectionMode) => ipcRenderer.invoke('image-files:select', mode),
        read: (path: string) => ipcRenderer.invoke('image-files:read', path),
        saveJpeg: (request: SaveJpegRequest) => ipcRenderer.invoke('image-files:save-jpeg', request),
    } satisfies ImageFilesMethods)
}

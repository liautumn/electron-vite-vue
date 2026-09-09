import {contextBridge, ipcRenderer} from 'electron'

export type ImageSelectionMode = 'images' | 'directory'

export interface ImageFileEntry {
    path: string
    name: string
}

export interface ImageFileContent extends ImageFileEntry {
    encoded: Uint8Array
    previewUrl: string
    width: number
    height: number
}

export interface SaveJpegRequest {
    name: string
    imageUrl: string
}

export const imageFilesApi = {
    select: (mode: ImageSelectionMode): Promise<ImageFileEntry[]> => ipcRenderer.invoke('image-files:select', mode),
    read: (path: string): Promise<ImageFileContent> => ipcRenderer.invoke('image-files:read', path),
    saveJpeg: (request: SaveJpegRequest): Promise<string | null> => ipcRenderer.invoke('image-files:save-jpeg', request),
}

export function registerImageFilesRenderer() {
    contextBridge.exposeInMainWorld('imageFiles', imageFilesApi)
}

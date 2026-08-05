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

export interface ImageFilesMethods {
    select(mode: ImageSelectionMode): Promise<ImageFileEntry[]>
    read(path: string): Promise<ImageFileContent>
    saveJpeg(request: SaveJpegRequest): Promise<string | null>
}

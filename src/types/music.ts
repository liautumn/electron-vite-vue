export type MusicDirectoryEntry = {
    name: string
    path: string
    isDirectory: boolean
    isFile: boolean
}

export type MusicMetadata = {
    common: {
        title: string
        artist: string
        album: string
        lyrics: string
        coverDataUrl: string
    }
    format: {
        duration: number | null
    }
}

export interface MusicMethods {
    selectDirectory: () => Promise<string | null>
    listDirectory: (dirPath: string) => Promise<MusicDirectoryEntry[]>
    readMetadata: (filePath: string) => Promise<MusicMetadata>
    readTextFile: (filePath: string) => Promise<string>
    readBinaryFile: (filePath: string) => Promise<Uint8Array>
    toFileUrl: (filePath: string) => Promise<string>
}

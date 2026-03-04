import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseFile, type IAudioMetadata } from 'music-metadata'

type DirectoryEntry = { name: string; path: string; isDirectory: boolean; isFile: boolean }
type MetadataPayload = {
  common: { title: string; artist: string; album: string; lyrics: string; coverDataUrl: string }
  format: { duration: number | null }
}

let musicRegistered = false

const normalizeText = (val: any): string => {
  if (typeof val === 'string') return val.trim()
  if (Array.isArray(val)) return val.map(normalizeText).find(Boolean) || ''
  if (val && typeof val === 'object' && val.text) return normalizeText(val.text)
  return ''
}

const pickLyrics = (meta: IAudioMetadata): string => {
  const commonLyrics = meta.common.lyrics?.map(normalizeText).filter(Boolean)
  if (commonLyrics?.length) return commonLyrics.join('\n')

  const tags = Object.values(meta.native).flat()
  for (const tag of tags) {
    if (/(LYR|USLT|SYLT)/i.test(tag.id || '')) {
      const text = normalizeText(tag.value)
      if (text) return text
    }
  }
  return ''
}

const pickCover = (meta: IAudioMetadata): string => {
  const pic = meta.common.picture?.[0]
  if (!pic?.data) return ''
  return `data:${pic.format || 'image/jpeg'};base64,${Buffer.from(pic.data).toString('base64')}`
}

const readMeta = async (file: string): Promise<MetadataPayload> => {
  const meta = await parseFile(file, { duration: true })
  return {
    common: {
      title: meta.common.title || path.parse(file).name,
      artist: meta.common.artist || '',
      album: meta.common.album || '',
      lyrics: pickLyrics(meta),
      coverDataUrl: pickCover(meta),
    },
    format: { duration: meta.format.duration ?? null },
  }
}

const checkPath = (p: any) => { if (typeof p !== 'string' || !p.trim()) throw new Error('Path required'); return p }

export function registerMusic(win: BrowserWindow) {
  if (musicRegistered) return
  musicRegistered = true

  ipcMain.handle('music:select-directory', async () => {
    const res = await dialog.showOpenDialog(win, { title: '选择音乐目录', properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('music:list-directory', async (_, dir) => {
    const p = checkPath(dir)
    return (await fs.readdir(p, { withFileTypes: true })).map(e => ({
      name: e.name, path: path.join(p, e.name), isDirectory: e.isDirectory(), isFile: e.isFile()
    }))
  })

  ipcMain.handle('music:read-metadata', async (_, p) => readMeta(checkPath(p)))
  ipcMain.handle('music:read-text-file', async (_, p) => fs.readFile(checkPath(p), 'utf-8'))
  ipcMain.handle('music:read-binary-file', async (_, p) => fs.readFile(checkPath(p)))
  ipcMain.handle('music:to-file-url', async (_, p) => pathToFileURL(checkPath(p)).toString())
}

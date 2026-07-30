import {contextBridge, ipcRenderer} from 'electron'
import type {
    SenseVoiceAudioChunk,
    SenseVoiceDownloadProgress,
    SenseVoiceMethods,
    SenseVoiceRecognitionResult,
    SenseVoiceStatus,
} from '../../../shared/types/sensevoice'

const subscribe = <T>(channel: string, callback: (payload: T) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
}

export function registerSenseVoiceRenderer() {
    contextBridge.exposeInMainWorld('senseVoice', {
        getStatus: () => ipcRenderer.invoke('sensevoice:get-status'),
        downloadModel: () => ipcRenderer.invoke('sensevoice:download-model'),
        start: (sampleRate: number) => ipcRenderer.invoke('sensevoice:start', sampleRate),
        pushAudio: (chunk: SenseVoiceAudioChunk) => ipcRenderer.send('sensevoice:audio', chunk),
        stop: () => ipcRenderer.invoke('sensevoice:stop'),
        reset: () => ipcRenderer.invoke('sensevoice:reset'),
        onStatus: (callback: (status: SenseVoiceStatus) => void) =>
            subscribe('sensevoice:status', callback),
        onDownloadProgress: (callback: (progress: SenseVoiceDownloadProgress) => void) =>
            subscribe('sensevoice:download-progress', callback),
        onResult: (callback: (result: SenseVoiceRecognitionResult) => void) =>
            subscribe('sensevoice:result', callback),
        onError: (callback: (message: string) => void) =>
            subscribe('sensevoice:error', callback),
    } satisfies SenseVoiceMethods)
}

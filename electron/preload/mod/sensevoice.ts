import {contextBridge, ipcRenderer} from 'electron'
import type {
    SenseVoiceAudioChunk,
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
        initialize: () => ipcRenderer.invoke('sensevoice:initialize'),
        dispose: () => ipcRenderer.invoke('sensevoice:dispose'),
        requestMicrophoneAccess: () => ipcRenderer.invoke('sensevoice:request-microphone-access'),
        getStatus: () => ipcRenderer.invoke('sensevoice:get-status'),
        start: (sampleRate: number) => ipcRenderer.invoke('sensevoice:start', sampleRate),
        pushAudio: (chunk: SenseVoiceAudioChunk) => ipcRenderer.send('sensevoice:audio', chunk),
        stop: () => ipcRenderer.invoke('sensevoice:stop'),
        reset: () => ipcRenderer.invoke('sensevoice:reset'),
        onStatus: (callback: (status: SenseVoiceStatus) => void) =>
            subscribe('sensevoice:status', callback),
        onResult: (callback: (result: SenseVoiceRecognitionResult) => void) =>
            subscribe('sensevoice:result', callback),
        onError: (callback: (message: string) => void) =>
            subscribe('sensevoice:error', callback),
    } satisfies SenseVoiceMethods)
}

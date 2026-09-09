import {contextBridge, ipcRenderer} from 'electron'

export type SenseVoiceEngineState =
    | 'missing'
    | 'loading'
    | 'ready'
    | 'recording'
    | 'error'

export type MicrophonePermissionStatus =
    | 'not-determined'
    | 'granted'
    | 'denied'
    | 'restricted'
    | 'unknown'

export interface SenseVoiceStatus {
    state: SenseVoiceEngineState
    modelAvailable: boolean
    engineReady: boolean
    configPath: string
    modelPath: string
    tokensPath: string
    message?: string
}

export interface SenseVoiceAudioChunk {
    sampleRate: number
    samples: Float32Array
}

export interface SenseVoiceRecognitionResult {
    kind: 'partial' | 'final'
    text: string
    segmentId: number
    audioDurationMs: number
    inferenceMs: number
    timestamp: string
}

const subscribe = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
}

export const senseVoiceApi = {
    initialize: (): Promise<SenseVoiceStatus> => ipcRenderer.invoke('sensevoice:initialize'),
    dispose: (): Promise<void> => ipcRenderer.invoke('sensevoice:dispose'),
    requestMicrophoneAccess: (): Promise<MicrophonePermissionStatus> => ipcRenderer.invoke('sensevoice:request-microphone-access'),
    getStatus: (): Promise<SenseVoiceStatus> => ipcRenderer.invoke('sensevoice:get-status'),
    start: (sampleRate: number): Promise<SenseVoiceStatus> => ipcRenderer.invoke('sensevoice:start', sampleRate),
    pushAudio: (chunk: SenseVoiceAudioChunk): void => ipcRenderer.send('sensevoice:audio', chunk),
    stop: (): Promise<SenseVoiceStatus> => ipcRenderer.invoke('sensevoice:stop'),
    reset: (): Promise<SenseVoiceStatus> => ipcRenderer.invoke('sensevoice:reset'),
    onStatus: (callback: (status: SenseVoiceStatus) => void) =>
        subscribe('sensevoice:status', callback),
    onResult: (callback: (result: SenseVoiceRecognitionResult) => void) =>
        subscribe('sensevoice:result', callback),
    onError: (callback: (message: string) => void) =>
        subscribe('sensevoice:error', callback),
}

export function registerSenseVoiceRenderer() {
    contextBridge.exposeInMainWorld('senseVoice', senseVoiceApi)
}

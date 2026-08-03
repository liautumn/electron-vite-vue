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

export interface SenseVoiceMethods {
    requestMicrophoneAccess(): Promise<MicrophonePermissionStatus>
    getStatus(): Promise<SenseVoiceStatus>
    start(sampleRate: number): Promise<SenseVoiceStatus>
    pushAudio(chunk: SenseVoiceAudioChunk): void
    stop(): Promise<SenseVoiceStatus>
    reset(): Promise<SenseVoiceStatus>
    onStatus(callback: (status: SenseVoiceStatus) => void): () => void
    onResult(callback: (result: SenseVoiceRecognitionResult) => void): () => void
    onError(callback: (message: string) => void): () => void
}

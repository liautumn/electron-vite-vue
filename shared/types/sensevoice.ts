export type SenseVoiceEngineState =
    | 'missing'
    | 'downloading'
    | 'loading'
    | 'ready'
    | 'recording'
    | 'error'

export type SenseVoiceDownloadStage = 'download' | 'extract' | 'complete'

export interface SenseVoiceStatus {
    state: SenseVoiceEngineState
    modelAvailable: boolean
    engineReady: boolean
    modelDirectory: string
    message?: string
}

export interface SenseVoiceDownloadProgress {
    stage: SenseVoiceDownloadStage
    receivedBytes: number
    totalBytes: number
    percent: number
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
    getStatus(): Promise<SenseVoiceStatus>
    downloadModel(): Promise<SenseVoiceStatus>
    start(sampleRate: number): Promise<SenseVoiceStatus>
    pushAudio(chunk: SenseVoiceAudioChunk): void
    stop(): Promise<SenseVoiceStatus>
    reset(): Promise<SenseVoiceStatus>
    onStatus(callback: (status: SenseVoiceStatus) => void): () => void
    onDownloadProgress(callback: (progress: SenseVoiceDownloadProgress) => void): () => void
    onResult(callback: (result: SenseVoiceRecognitionResult) => void): () => void
    onError(callback: (message: string) => void): () => void
}

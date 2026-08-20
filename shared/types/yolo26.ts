import type {EncodedImage, RgbaImage} from './image'

export type Yolo26EngineState = 'missing' | 'idle' | 'loading' | 'ready' | 'error'

export interface Yolo26Status {
    state: Yolo26EngineState
    modelAvailable: boolean
    configPath: string
    modelPath: string
    engineReady: boolean
    provider: string
    gpuAvailable: boolean
    gpuEnabled: boolean
    gpuProvider: string | null
    inputSize: number
    classCount: number
    message?: string
}

export interface Yolo26Detection {
    classId: number
    className: string
    confidence: number
    box: [number, number, number, number]
}

export interface Yolo26InferenceResult {
    width: number
    height: number
    preprocessMs: number
    inferenceMs: number
    detections: Yolo26Detection[]
}

export interface Yolo26ImageRequest {
    image: EncodedImage
    confidence: number
}

export interface Yolo26FrameRequest {
    frameId: number
    frame: RgbaImage
    confidence: number
}

export interface Yolo26FrameInferenceResult extends Yolo26InferenceResult {
    frameId: number
}

export interface Yolo26StressResult {
    name: string
    iterations: number
    warmupRuns: number
    inputWidth: number
    inputHeight: number
    preprocessMs: number
    inferenceMs: number
    totalMs: number
    fps: number
}

export interface Yolo26Methods {
    initialize(): Promise<Yolo26Status>
    dispose(): Promise<void>
    getStatus(): Promise<Yolo26Status>
    setGpuEnabled(enabled: boolean): Promise<Yolo26Status>
    inferImage(request: Yolo26ImageRequest): Promise<Yolo26InferenceResult>
    inferFrame(request: Yolo26FrameRequest): Promise<Yolo26FrameInferenceResult>
    stressTest(): Promise<Yolo26StressResult>
}

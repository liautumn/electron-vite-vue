import {contextBridge, ipcRenderer} from 'electron'

export interface EncodedImage {
    bytes: Uint8Array
}

export interface RgbaImage {
    pixelFormat: 'rgba8'
    width: number
    height: number
    pixels: Uint8Array
}

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

export const yolo26Api = {
    initialize: (): Promise<Yolo26Status> => ipcRenderer.invoke('yolo26:initialize'),
    dispose: (): Promise<void> => ipcRenderer.invoke('yolo26:dispose'),
    getStatus: (): Promise<Yolo26Status> => ipcRenderer.invoke('yolo26:get-status'),
    setGpuEnabled: (enabled: boolean): Promise<Yolo26Status> => ipcRenderer.invoke('yolo26:set-gpu-enabled', enabled),
    inferImage: (request: Yolo26ImageRequest): Promise<Yolo26InferenceResult> => ipcRenderer.invoke('yolo26:infer-image', request),
    inferFrame: (request: Yolo26FrameRequest): Promise<Yolo26FrameInferenceResult> => ipcRenderer.invoke('yolo26:infer-frame', request),
    stressTest: (): Promise<Yolo26StressResult> => ipcRenderer.invoke('yolo26:stress-test'),
}

export function registerYolo26Renderer() {
    contextBridge.exposeInMainWorld('yolo26', yolo26Api)
}

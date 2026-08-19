import {app, BrowserWindow, ipcMain} from 'electron'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {performance} from 'node:perf_hooks'
import type * as ort from 'onnxruntime-node'
import type {RgbaImage} from '../../../shared/types/image'
import type {
    Yolo26Detection,
    Yolo26EngineState,
    Yolo26FrameInferenceResult,
    Yolo26FrameRequest,
    Yolo26ImageRequest,
    Yolo26InferenceResult,
    Yolo26Status,
    Yolo26StressResult,
} from '../../../shared/types/yolo26'
import {createLogger} from '../utils/logger'
import {getModelConfigPath, readModelConfigSection} from '../utils/model-config'
import {resolvePortablePath} from '../utils/portable-path'
import {
    preprocessYolo26,
    type Yolo26PixelImage,
    type Yolo26PreprocessedImage,
} from './yolo26-preprocess'

const INPUT_SIZE = 640
const STRESS_WARMUP_RUNS = 3
const STRESS_ITERATIONS = 20
const MAX_IMAGE_PIXELS = 25_000_000
const MAX_FRAME_PIXELS = 1920 * 1080
const MAX_ENCODED_IMAGE_BYTES = 32 * 1024 * 1024
const PROVIDER = 'CPUExecutionProvider'

const log = createLogger('yolo26')

type Yolo26Config = {
    modelPath?: unknown
    names?: unknown
}

type ResolvedModelConfig = {
    configPath: string
    modelPath: string
    names: string[]
    error?: string
}

type NamesFile = {
    names?: unknown
}

let mainWindow: BrowserWindow | null = null
let registered = false
let session: ort.InferenceSession | null = null
let sessionPromise: Promise<ort.InferenceSession> | null = null
let activeNames: string[] = []
let engineState: Yolo26EngineState = 'idle'
let engineMessage = ''
let inferenceQueue: Promise<void> = Promise.resolve()
let shuttingDown = false
let engineActive = false
let lifecycleQueue: Promise<void> = Promise.resolve()

const enqueueLifecycle = <Result>(operation: () => Promise<Result>) => {
    const queued = lifecycleQueue.then(operation, operation)
    lifecycleQueue = queued.then(() => undefined, () => undefined)
    return queued
}

const isValidNames = (value: unknown): value is string[] =>
    Array.isArray(value)
    && value.length > 0
    && value.every(name => typeof name === 'string' && name.trim().length > 0)

const resolveNames = (
    value: unknown,
    pathOptions: Parameters<typeof resolvePortablePath>[1]
): {names: string[], error?: string} => {
    if (isValidNames(value)) return {names: value}

    const namesPath = resolvePortablePath(value, pathOptions)
    if (!namesPath) {
        return {names: [], error: 'YOLO26 配置必须指定 names 类别文件'}
    }
    if (!existsSync(namesPath)) {
        return {names: [], error: `YOLO26 类别文件不存在：${namesPath}`}
    }

    let namesFile: unknown
    try {
        namesFile = JSON.parse(readFileSync(namesPath, 'utf8'))
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {names: [], error: `YOLO26 类别文件读取失败：${detail}`}
    }

    const names = Array.isArray(namesFile)
        ? namesFile
        : (namesFile as NamesFile | null)?.names
    if (!isValidNames(names)) {
        return {names: [], error: 'YOLO26 类别文件必须提供非空字符串数组 names'}
    }
    return {names}
}

const resolveModelConfig = (): ResolvedModelConfig => {
    const configPath = getModelConfigPath('YOLO26_CONFIG_PATH')
    if (!existsSync(configPath)) {
        return {
            configPath,
            modelPath: '',
            names: [],
            error: `YOLO26 配置文件不存在：${configPath}`,
        }
    }

    try {
        const config = readModelConfigSection<Yolo26Config>(configPath, 'yolo26')
        const pathOptions = {
            configDirectory: path.dirname(configPath),
            userDataDirectory: app.getPath('userData'),
        }
        const modelPath = resolvePortablePath(config.modelPath, pathOptions)
        if (!modelPath) {
            return {
                configPath,
                modelPath,
                names: [],
                error: 'YOLO26 配置必须指定 modelPath',
            }
        }
        const resolvedNames = resolveNames(config.names, pathOptions)
        if (resolvedNames.error) {
            return {
                configPath,
                modelPath,
                names: [],
                error: resolvedNames.error,
            }
        }
        return {
            configPath,
            modelPath,
            names: resolvedNames.names,
            ...(!existsSync(modelPath) ? {error: `YOLO26 模型不存在：${modelPath}`} : {}),
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {
            configPath,
            modelPath: '',
            names: [],
            error: `YOLO26 配置读取失败：${detail}`,
        }
    }
}

const currentStatus = (): Yolo26Status => {
    const modelConfig = resolveModelConfig()
    const modelAvailable = !modelConfig.error
    return {
        state: modelAvailable ? engineState : 'missing',
        modelAvailable,
        configPath: modelConfig.configPath,
        modelPath: modelConfig.modelPath,
        engineReady: Boolean(session),
        provider: PROVIDER,
        inputSize: INPUT_SIZE,
        classCount: modelConfig.names.length,
        ...(modelConfig.error
            ? {message: modelConfig.error}
            : engineMessage
                ? {message: engineMessage}
                : {}),
    }
}

const getSession = async () => {
    if (!engineActive) throw new Error('YOLO26 页面未激活')
    if (shuttingDown) throw new Error('YOLO26 正在销毁')
    if (session) return session
    if (sessionPromise) return sessionPromise

    const modelConfig = resolveModelConfig()
    if (modelConfig.error) {
        engineState = 'error'
        engineMessage = modelConfig.error
        log.error('Failed to initialize YOLO26', {
            configPath: modelConfig.configPath,
            modelPath: modelConfig.modelPath,
            error: modelConfig.error,
        })
        throw new Error(modelConfig.error)
    }

    engineState = 'loading'
    engineMessage = ''
    const startedAt = performance.now()
    log.info('YOLO26 initialization started', {
        configPath: modelConfig.configPath,
        modelPath: modelConfig.modelPath,
        provider: PROVIDER,
    })
    sessionPromise = import('onnxruntime-node')
        .then(ortRuntime => ortRuntime.InferenceSession.create(modelConfig.modelPath, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
        }))
        .then(async createdSession => {
            try {
                const input = createdSession.inputMetadata[0]
                const output = createdSession.outputMetadata[0]
                if (!input || !input.isTensor) throw new Error('模型输入必须是 Tensor')
                if (input.type !== 'float32') {
                    throw new Error(`模型输入必须是 float32 Tensor，当前为 ${input.type}`)
                }
                if (!output || !output.isTensor) throw new Error('模型输出必须是 Tensor')
                if (output.shape.at(-1) !== 6) {
                    throw new Error(`模型必须使用 YOLO26 end-to-end 输出，当前形状为 ${output.shape.join('×')}`)
                }
                session = createdSession
                activeNames = modelConfig.names
                engineState = 'ready'
                log.info('YOLO26 session ready', {
                    configPath: modelConfig.configPath,
                    modelPath: modelConfig.modelPath,
                    inputShape: input.shape,
                    outputShape: output.shape,
                    durationMs: Number((performance.now() - startedAt).toFixed(1)),
                })
                return createdSession
            } catch (error) {
                try {
                    await createdSession.release()
                } catch (releaseError) {
                    log.error('Failed to release invalid YOLO26 session', releaseError)
                }
                throw error
            }
        })
        .catch(error => {
            engineState = 'error'
            engineMessage = error instanceof Error ? error.message : String(error)
            sessionPromise = null
            log.error('Failed to initialize YOLO26', error)
            throw error
        })

    return sessionPromise
}

const decodeImage = async (source: Uint8Array | undefined): Promise<Yolo26PixelImage> => {
    if (!(source instanceof Uint8Array) || !source.byteLength || source.byteLength > MAX_ENCODED_IMAGE_BYTES) {
        throw new Error('无效的编码图片数据')
    }

    const {default: sharp} = await import('sharp')
    const encoded = Buffer.from(source.buffer, source.byteOffset, source.byteLength)
    const {data, info} = await sharp(encoded, {failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS})
        .rotate()
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({resolveWithObject: true})
    if (!info.width || !info.height || info.channels !== 3) throw new Error('无法读取图片像素')
    if (info.width * info.height > MAX_IMAGE_PIXELS) throw new Error('图片尺寸超过推理上限')
    return {
        pixels: data,
        width: info.width,
        height: info.height,
        channels: 3,
    }
}

const createStressImage = (width: number, height: number): Yolo26PixelImage => {
    const pixels = Buffer.allocUnsafe(width * height * 3)
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 3
            pixels[offset] = Math.round(x * 255 / Math.max(width - 1, 1))
            pixels[offset + 1] = Math.round(y * 255 / Math.max(height - 1, 1))
            pixels[offset + 2] = ((x >> 5) ^ (y >> 5)) & 1 ? 220 : 40
        }
    }
    return {pixels, width, height, channels: 3}
}

const getInputDimensions = (activeSession: ort.InferenceSession) => {
    const inputMetadata = activeSession.inputMetadata[0]
    if (!inputMetadata?.isTensor) throw new Error('模型输入必须是 Tensor')
    return {
        inputHeight: typeof inputMetadata.shape[2] === 'number' ? inputMetadata.shape[2] : INPUT_SIZE,
        inputWidth: typeof inputMetadata.shape[3] === 'number' ? inputMetadata.shape[3] : INPUT_SIZE,
    }
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum)

const parseDetections = (
    output: ort.Tensor,
    confidence: number,
    image: Yolo26PreprocessedImage,
    names: string[]
): Yolo26Detection[] => {
    if (!(output.data instanceof Float32Array) || output.dims.at(-1) !== 6) {
        throw new Error(`无法解析模型输出：${output.dims.join('×')}`)
    }

    const detections: Yolo26Detection[] = []
    for (let offset = 0; offset < output.data.length; offset += 6) {
        const score = output.data[offset + 4]
        if (score < confidence) continue

        const classId = Math.trunc(output.data[offset + 5])
        const x1 = clamp((output.data[offset] - image.padX) / image.gain, 0, image.width)
        const y1 = clamp((output.data[offset + 1] - image.padY) / image.gain, 0, image.height)
        const x2 = clamp((output.data[offset + 2] - image.padX) / image.gain, 0, image.width)
        const y2 = clamp((output.data[offset + 3] - image.padY) / image.gain, 0, image.height)
        if (x2 <= x1 || y2 <= y1) continue

        detections.push({
            classId,
            className: names[classId] ?? String(classId),
            confidence: score,
            box: [x1, y1, x2, y2],
        })
    }
    return detections
}

const validateConfidence = (confidence: number) => {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('置信度必须在 0 到 1 之间')
}

const enqueueInference = <Result>(operation: () => Promise<Result>) => {
    if (shuttingDown) return Promise.reject(new Error('YOLO26 正在销毁'))
    const queued = inferenceQueue.then(operation)
    inferenceQueue = queued.then(() => undefined, () => undefined)
    return queued
}

const inferPixels = async (pixels: Yolo26PixelImage, confidence: number) => {
    validateConfidence(confidence)
    const activeSession = await getSession()
    const {inputHeight, inputWidth} = getInputDimensions(activeSession)
    const preprocessStartedAt = performance.now()
    const image = await preprocessYolo26(pixels, inputHeight, inputWidth)
    const preprocessMs = performance.now() - preprocessStartedAt

    const startedAt = performance.now()
    const outputs = await enqueueInference(() => activeSession.run({[activeSession.inputNames[0]]: image.tensor}))
    const inferenceMs = performance.now() - startedAt
    const detections = parseDetections(
        outputs[activeSession.outputNames[0]] as ort.Tensor,
        confidence,
        image,
        activeNames
    )
    return {image, preprocessMs, inferenceMs, detections}
}

const inferImage = async (request: Yolo26ImageRequest): Promise<Yolo26InferenceResult> => {
    const decoded = await decodeImage(request?.image?.bytes)
    const {image, preprocessMs, inferenceMs, detections} = await inferPixels(decoded, request?.confidence)
    return {
        width: image.width,
        height: image.height,
        preprocessMs,
        inferenceMs,
        detections,
    }
}

const toRgbaPixels = (image: RgbaImage | undefined): Yolo26PixelImage => {
    if (!image || image.pixelFormat !== 'rgba8') throw new Error('仅支持 rgba8 图片帧')
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height)
        || image.width <= 0 || image.height <= 0
        || image.width * image.height > MAX_FRAME_PIXELS) {
        throw new Error('无效的图片帧尺寸')
    }
    if (!(image.pixels instanceof Uint8Array)
        || image.pixels.byteLength !== image.width * image.height * 4) {
        throw new Error('无效的图片帧像素数据')
    }
    return {
        pixels: image.pixels,
        width: image.width,
        height: image.height,
        channels: 4,
    }
}

const inferFrame = async (request: Yolo26FrameRequest): Promise<Yolo26FrameInferenceResult> => {
    if (!Number.isSafeInteger(request?.frameId) || request.frameId < 0) throw new Error('无效的图片帧编号')
    const pixels = toRgbaPixels(request?.frame)
    const {preprocessMs, inferenceMs, detections} = await inferPixels(pixels, request.confidence)
    return {
        frameId: request.frameId,
        width: pixels.width,
        height: pixels.height,
        preprocessMs,
        inferenceMs,
        detections,
    }
}

const stressTest = async (): Promise<Yolo26StressResult> => {
    const activeSession = await getSession()
    const {inputHeight, inputWidth} = getInputDimensions(activeSession)
    const inputName = activeSession.inputNames[0]
    const stressImage = createStressImage(inputWidth, inputHeight)

    for (let index = 0; index < STRESS_WARMUP_RUNS; index += 1) {
        const image = await preprocessYolo26(stressImage, inputHeight, inputWidth)
        await enqueueInference(() => activeSession.run({[inputName]: image.tensor}))
    }

    let preprocessMs = 0
    let inferenceMs = 0
    for (let index = 0; index < STRESS_ITERATIONS; index += 1) {
        const preprocessStartedAt = performance.now()
        const image = await preprocessYolo26(stressImage, inputHeight, inputWidth)
        preprocessMs += performance.now() - preprocessStartedAt

        const inferenceStartedAt = performance.now()
        await enqueueInference(() => activeSession.run({[inputName]: image.tensor}))
        inferenceMs += performance.now() - inferenceStartedAt
    }

    const averagePreprocessMs = preprocessMs / STRESS_ITERATIONS
    const averageInferenceMs = inferenceMs / STRESS_ITERATIONS
    const averageTotalMs = averagePreprocessMs + averageInferenceMs
    return {
        name: '后台模拟图片',
        iterations: STRESS_ITERATIONS,
        warmupRuns: STRESS_WARMUP_RUNS,
        inputWidth,
        inputHeight,
        preprocessMs: averagePreprocessMs,
        inferenceMs: averageInferenceMs,
        totalMs: averageTotalMs,
        fps: 1000 / averageTotalMs,
    }
}

const initializeYolo26 = () => enqueueLifecycle(async () => {
    engineActive = true
    shuttingDown = false
    try {
        await getSession()
    } catch {
        // Initialization failures are reflected in the returned status.
    }
    return currentStatus()
})

const releaseYolo26Engine = () => {
    engineActive = false
    shuttingDown = true

    return enqueueLifecycle(async () => {
        const startedAt = performance.now()
        log.info('YOLO26 engine disposal started', {
            state: engineState,
            sessionReady: Boolean(session),
        })

        try {
            try {
                await sessionPromise
            } catch {
                // Initialization failures are already reflected in engine state.
            }
            await inferenceQueue

            const activeSession = session
            session = null
            sessionPromise = null
            if (activeSession) await activeSession.release()

            activeNames = []
            engineState = 'idle'
            engineMessage = ''
            log.info('YOLO26 engine disposal completed', {
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                sessionReleased: Boolean(activeSession),
            })
        } finally {
            shuttingDown = false
        }
    })
}

export function registerYolo26(window: BrowserWindow) {
    mainWindow = window
    if (!registered) {
        registered = true
        log.info('YOLO26 IPC handlers registered')

        ipcMain.handle('yolo26:initialize', event => {
            if (event.sender !== mainWindow?.webContents) throw new Error('无权初始化 YOLO26')
            return initializeYolo26()
        })
        ipcMain.handle('yolo26:dispose', event => {
            if (event.sender !== mainWindow?.webContents) throw new Error('无权销毁 YOLO26')
            return releaseYolo26Engine()
        })
        ipcMain.handle('yolo26:get-status', event => {
            if (event.sender !== mainWindow?.webContents) throw new Error('无权读取 YOLO26 状态')
            return currentStatus()
        })
        ipcMain.handle('yolo26:infer-image', (event, request: Yolo26ImageRequest) => {
            if (event.sender !== mainWindow?.webContents) throw new Error('无权执行 YOLO26 推理')
            return inferImage(request)
        })
        ipcMain.handle('yolo26:infer-frame', (event, request: Yolo26FrameRequest) => {
            if (event.sender !== mainWindow?.webContents) throw new Error('无权执行 YOLO26 帧推理')
            return inferFrame(request)
        })
        ipcMain.handle('yolo26:stress-test', event => {
            if (event.sender !== mainWindow?.webContents) throw new Error('无权执行 YOLO26 压力测试')
            return stressTest()
        })
    }
}

export async function disposeYolo26() {
    await releaseYolo26Engine()
    mainWindow = null
}

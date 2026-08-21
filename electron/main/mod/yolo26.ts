import {app, BrowserWindow, ipcMain, type IpcMainInvokeEvent} from 'electron'
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
import {preprocessYolo26, type Yolo26PixelImage, type Yolo26PreprocessedImage} from './yolo26-preprocess'

// 解码后允许的最大像素数，防止超大图片占用过多内存。
const MAX_IMAGE_PIXELS = 25_000_000
// 摄像头单帧的最大像素数，当前限制为 1080p。
const MAX_FRAME_PIXELS = 1920 * 1080
// Renderer 传入的压缩图片最大字节数，当前限制为 32 MiB。
const MAX_ENCODED_IMAGE_BYTES = 32 * 1024 * 1024
// 压力测试正式计时前的预热次数，用于排除首次运行开销。
const STRESS_WARMUP_RUNS = 3
// 压力测试的计时次数，最终结果取这些运行的平均值。
const STRESS_ITERATIONS = 20
// CPU provider 的展示名称，用于状态返回和日志。
const CPU_PROVIDER = 'CPUExecutionProvider'
// CoreML：要求使用 ML Program 格式创建模型。
const COREML_CREATE_MLPROGRAM = 0x010
// CoreML：允许模型同时使用 CPU 和 GPU 计算单元。
const COREML_USE_CPU_AND_GPU = 0x020

const log = createLogger('yolo26')

type ExecutionTarget = 'cpu' | 'gpu'
type ModelFloatType = 'float32' | 'float16'

type GpuProvider = {
    backend: 'coreml' | 'dml' | 'cuda'
    displayName: string
}

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

type ActiveEngine = {
    runtime: typeof import('onnxruntime-node')
    session: ort.InferenceSession
    names: string[]
    inputName: string
    outputName: string
    inputType: ModelFloatType
    outputType: ModelFloatType
    inputWidth: number
    inputHeight: number
}

const resolveGpuProvider = (): GpuProvider | null => {
    if (process.platform === 'darwin') return {backend: 'coreml', displayName: 'CoreMLExecutionProvider'}
    if (process.platform === 'win32') return {backend: 'dml', displayName: 'DmlExecutionProvider'}
    if (process.platform === 'linux' && process.arch === 'x64') {
        return {backend: 'cuda', displayName: 'CUDAExecutionProvider'}
    }
    return null
}

const gpuProvider = resolveGpuProvider()
let mainWindow: BrowserWindow | null = null
let registered = false
let engine: ActiveEngine | null = null
let enginePromise: Promise<ActiveEngine> | null = null
let engineState: Yolo26EngineState = 'idle'
let engineMessage = ''
let engineActive = false
let shuttingDown = false
let executionTarget: ExecutionTarget = 'cpu'
let inferenceQueue: Promise<void> = Promise.resolve()
let lifecycleQueue: Promise<void> = Promise.resolve()
let runtimePromise: Promise<typeof import('onnxruntime-node')> | null = null
let gpuAvailablePromise: Promise<boolean> | null = null

const enqueueLifecycle = <Result>(operation: () => Promise<Result>) => {
    const queued = lifecycleQueue.then(operation, operation)
    lifecycleQueue = queued.then(() => undefined, () => undefined)
    return queued
}

const enqueueInference = <Result>(operation: () => Promise<Result>) => {
    if (shuttingDown) return Promise.reject(new Error('YOLO26 正在销毁'))
    const queued = inferenceQueue.then(operation)
    inferenceQueue = queued.then(() => undefined, () => undefined)
    return queued
}

const loadRuntime = () => {
    runtimePromise ??= import('onnxruntime-node')
    return runtimePromise
}

const isGpuAvailable = () => {
    if (!gpuProvider) return Promise.resolve(false)
    gpuAvailablePromise ??= loadRuntime()
        .then(runtime => runtime.listSupportedBackends().some(backend => backend.name === gpuProvider.backend))
        .catch(() => false)
    return gpuAvailablePromise
}

const providerName = (target = executionTarget) =>
    target === 'gpu' && gpuProvider ? gpuProvider.displayName : CPU_PROVIDER

const createSessionOptions = (target: ExecutionTarget): ort.InferenceSession.SessionOptions => {
    const base: ort.InferenceSession.SessionOptions = {graphOptimizationLevel: 'all'}
    if (target === 'cpu' || !gpuProvider) return {...base, executionProviders: ['cpu']}

    if (gpuProvider.backend === 'coreml') {
        return {
            ...base,
            executionProviders: [{
                name: 'coreml',
                coreMlFlags: COREML_CREATE_MLPROGRAM | COREML_USE_CPU_AND_GPU,
            }, 'cpu'],
        }
    }
    if (gpuProvider.backend === 'dml') {
        return {
            ...base,
            executionProviders: [{name: 'dml', deviceId: 0}, 'cpu'],
            enableMemPattern: false,
            executionMode: 'sequential',
        }
    }
    return {...base, executionProviders: [{name: 'cuda', deviceId: 0}, 'cpu']}
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
    if (!namesPath) return {names: [], error: 'YOLO26 配置必须指定 names 类别文件'}
    if (!existsSync(namesPath)) return {names: [], error: `YOLO26 类别文件不存在：${namesPath}`}

    try {
        const file: unknown = JSON.parse(readFileSync(namesPath, 'utf8'))
        const names = Array.isArray(file) ? file : (file as {names?: unknown} | null)?.names
        return isValidNames(names)
            ? {names}
            : {names: [], error: 'YOLO26 类别文件必须提供非空字符串数组 names'}
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {names: [], error: `YOLO26 类别文件读取失败：${detail}`}
    }
}

const resolveModelConfig = (): ResolvedModelConfig => {
    const configPath = getModelConfigPath('YOLO26_CONFIG_PATH')
    if (!existsSync(configPath)) {
        return {configPath, modelPath: '', names: [], error: `YOLO26 配置文件不存在：${configPath}`}
    }

    try {
        const config = readModelConfigSection<Yolo26Config>(configPath, 'yolo26')
        const pathOptions = {
            configDirectory: path.dirname(configPath),
            userDataDirectory: app.getPath('userData'),
        }
        const modelPath = resolvePortablePath(config.modelPath, pathOptions)
        if (!modelPath) {
            return {configPath, modelPath, names: [], error: 'YOLO26 配置必须指定 modelPath'}
        }

        const resolvedNames = resolveNames(config.names, pathOptions)
        if (resolvedNames.error) return {configPath, modelPath, ...resolvedNames}
        return {
            configPath,
            modelPath,
            names: resolvedNames.names,
            ...(!existsSync(modelPath) ? {error: `YOLO26 模型不存在：${modelPath}`} : {}),
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {configPath, modelPath: '', names: [], error: `YOLO26 配置读取失败：${detail}`}
    }
}

const currentStatus = async (): Promise<Yolo26Status> => {
    const modelConfig = resolveModelConfig()
    return {
        state: modelConfig.error ? 'missing' : engineState,
        modelAvailable: !modelConfig.error,
        configPath: modelConfig.configPath,
        modelPath: modelConfig.modelPath,
        engineReady: Boolean(engine),
        provider: providerName(),
        gpuAvailable: await isGpuAvailable(),
        gpuEnabled: executionTarget === 'gpu',
        gpuProvider: gpuProvider?.displayName ?? null,
        inputSize: engine?.inputWidth ?? 0,
        classCount: modelConfig.names.length,
        ...(modelConfig.error
            ? {message: modelConfig.error}
            : engineMessage
                ? {message: engineMessage}
                : {}),
    }
}

const fixedDimension = (value: number | string, name: string) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`模型 ${name} 必须是固定正整数，当前为 ${String(value)}`)
    }
    return value
}

const isModelFloatType = (type: string): type is ModelFloatType =>
    type === 'float32' || type === 'float16'

const inspectSession = (
    runtime: typeof import('onnxruntime-node'),
    session: ort.InferenceSession,
    names: string[]
): ActiveEngine => {
    if (session.inputNames.length !== 1) throw new Error('模型必须只有一个图片输入')
    if (!session.outputNames[0]) throw new Error('模型没有输出')

    const input = session.inputMetadata[0]
    const output = session.outputMetadata[0]
    if (!input?.isTensor) throw new Error('模型输入必须是 Tensor')
    if (!isModelFloatType(input.type)) {
        throw new Error(`模型输入必须是 float32 或 float16 Tensor，当前为 ${input.type}`)
    }
    if (input.shape.length !== 4) {
        throw new Error(`模型输入必须使用 NCHW 四维形状，当前为 ${input.shape.join('×')}`)
    }

    const [batch, channels, height, width] = input.shape
    if (batch !== 1) throw new Error(`模型必须是单张图片推理，batch 必须为 1，当前为 ${String(batch)}`)
    if (channels !== 3) throw new Error(`模型输入通道必须为 3，当前为 ${String(channels)}`)
    if (!output?.isTensor) throw new Error('模型输出必须是 Tensor')
    if (!isModelFloatType(output.type)) {
        throw new Error(`模型输出必须是 float32 或 float16 Tensor，当前为 ${output.type}`)
    }
    if (output.shape.at(-1) !== 6) {
        throw new Error(`模型必须使用 YOLO26 end-to-end 输出，当前形状为 ${output.shape.join('×')}`)
    }

    const inputWidth = fixedDimension(width, '输入宽度')
    const inputHeight = fixedDimension(height, '输入高度')
    return {
        runtime,
        session,
        names,
        inputName: session.inputNames[0],
        outputName: session.outputNames[0],
        inputType: input.type,
        outputType: output.type,
        inputWidth,
        inputHeight,
    }
}

const getEngine = async (): Promise<ActiveEngine> => {
    if (!engineActive) throw new Error('YOLO26 页面未激活')
    if (shuttingDown) throw new Error('YOLO26 正在销毁')
    if (engine) return engine
    if (enginePromise) return enginePromise

    const config = resolveModelConfig()
    if (config.error) {
        engineState = 'error'
        engineMessage = config.error
        log.error('Failed to initialize YOLO26', {
            configPath: config.configPath,
            modelPath: config.modelPath,
            error: config.error,
        })
        throw new Error(config.error)
    }

    const target = executionTarget
    const provider = providerName(target)
    const startedAt = performance.now()
    engineState = 'loading'
    engineMessage = ''
    log.info('YOLO26 initialization started', {
        configPath: config.configPath,
        modelPath: config.modelPath,
        provider,
    })

    enginePromise = (async () => {
        const runtime = await loadRuntime()
        if (target === 'gpu' && !await isGpuAvailable()) {
            throw new Error(`当前 ONNX Runtime 不支持 ${gpuProvider?.displayName ?? 'GPU provider'}`)
        }

        const session = await runtime.InferenceSession.create(config.modelPath, createSessionOptions(target))
        try {
            engine = inspectSession(runtime, session, config.names)
            engineState = 'ready'
            const outputMetadata = session.outputMetadata[0]
            log.info('YOLO26 session ready', {
                configPath: config.configPath,
                modelPath: config.modelPath,
                inputShape: [1, 3, engine.inputHeight, engine.inputWidth],
                inputType: engine.inputType,
                outputShape: outputMetadata?.isTensor ? outputMetadata.shape : undefined,
                outputType: engine.outputType,
                provider,
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
            })
            return engine
        } catch (error) {
            try {
                await session.release()
            } catch (releaseError) {
                log.error('Failed to release invalid YOLO26 session', releaseError)
            }
            throw error
        }
    })().catch(error => {
        engineState = 'error'
        engineMessage = error instanceof Error ? error.message : String(error)
        enginePromise = null
        log.error('Failed to initialize YOLO26', error)
        throw error
    })

    return enginePromise
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
    return {pixels: data, width: info.width, height: info.height, channels: 3}
}

const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum)

const toFloat16Bits = (data: Float32Array) => {
    const values = Float16Array.from(data)
    return new Uint16Array(values.buffer, values.byteOffset, values.length)
}

const getFloatData = (output: ort.Tensor) => {
    if (output.type === 'float32' && output.data instanceof Float32Array) return output.data
    if (output.type === 'float16') {
        if (output.data instanceof Float16Array) return output.data
        if (output.data instanceof Uint16Array) {
            return new Float16Array(output.data.buffer, output.data.byteOffset, output.data.length)
        }
    }
    throw new Error(`无法解析模型输出类型：${output.type}`)
}

const parseDetections = (
    output: ort.Tensor,
    confidence: number,
    image: Yolo26PreprocessedImage,
    names: string[]
): Yolo26Detection[] => {
    if (!output || output.dims.at(-1) !== 6) {
        throw new Error(`无法解析模型输出：${output?.dims.join('×') ?? '无输出'}`)
    }

    const data = getFloatData(output)
    const detections: Yolo26Detection[] = []
    for (let offset = 0; offset < data.length; offset += 6) {
        const score = data[offset + 4]
        if (score < confidence) continue

        const classId = Math.trunc(data[offset + 5])
        const x1 = clamp((data[offset] - image.padX) / image.gain, 0, image.width)
        const y1 = clamp((data[offset + 1] - image.padY) / image.gain, 0, image.height)
        const x2 = clamp((data[offset + 2] - image.padX) / image.gain, 0, image.width)
        const y2 = clamp((data[offset + 3] - image.padY) / image.gain, 0, image.height)
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
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error('置信度必须在 0 到 1 之间')
    }
}

const preprocessInput = async (activeEngine: ActiveEngine, pixels: Yolo26PixelImage) => {
    const image = await preprocessYolo26(pixels, activeEngine.inputHeight, activeEngine.inputWidth)
    const dimensions = [1, 3, activeEngine.inputHeight, activeEngine.inputWidth]
    const tensor = activeEngine.inputType === 'float16'
        ? new activeEngine.runtime.Tensor('float16', toFloat16Bits(image.data), dimensions)
        : new activeEngine.runtime.Tensor('float32', image.data, dimensions)
    return {image, tensor}
}

const inferPixels = (pixels: Yolo26PixelImage, confidence: number) => {
    validateConfidence(confidence)
    return enqueueInference(async () => {
        const activeEngine = await getEngine()
        const preprocessStartedAt = performance.now()
        const {image, tensor} = await preprocessInput(activeEngine, pixels)
        const preprocessMs = performance.now() - preprocessStartedAt

        const inferenceStartedAt = performance.now()
        const outputs = await activeEngine.session.run({[activeEngine.inputName]: tensor})
        const inferenceMs = performance.now() - inferenceStartedAt
        const detections = parseDetections(
            outputs[activeEngine.outputName] as ort.Tensor,
            confidence,
            image,
            activeEngine.names
        )
        return {image, preprocessMs, inferenceMs, detections}
    })
}

const inferImage = async (request: Yolo26ImageRequest): Promise<Yolo26InferenceResult> => {
    try {
        const source = await decodeImage(request?.image?.bytes)
        const {image, preprocessMs, inferenceMs, detections} = await inferPixels(source, request?.confidence)
        log.info('YOLO26 image inference completed', {
            sourceSize: [source.width, source.height],
            detections: detections.length,
            preprocessMs: Number(preprocessMs.toFixed(1)),
            inferenceMs: Number(inferenceMs.toFixed(1)),
            provider: providerName(),
        })
        return {width: image.width, height: image.height, preprocessMs, inferenceMs, detections}
    } catch (error) {
        log.error('YOLO26 image inference failed', error)
        throw error
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
    return {pixels: image.pixels, width: image.width, height: image.height, channels: 4}
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

const stressTest = (): Promise<Yolo26StressResult> => enqueueInference(async () => {
    const activeEngine = await getEngine()
    const {inputWidth, inputHeight, inputName, session} = activeEngine
    const source = createStressImage(inputWidth, inputHeight)

    for (let index = 0; index < STRESS_WARMUP_RUNS; index += 1) {
        const {tensor} = await preprocessInput(activeEngine, source)
        await session.run({[inputName]: tensor})
    }

    let preprocessMs = 0
    let inferenceMs = 0
    for (let index = 0; index < STRESS_ITERATIONS; index += 1) {
        const preprocessStartedAt = performance.now()
        const {tensor} = await preprocessInput(activeEngine, source)
        preprocessMs += performance.now() - preprocessStartedAt

        const inferenceStartedAt = performance.now()
        await session.run({[inputName]: tensor})
        inferenceMs += performance.now() - inferenceStartedAt
    }

    const averagePreprocessMs = preprocessMs / STRESS_ITERATIONS
    const averageInferenceMs = inferenceMs / STRESS_ITERATIONS
    const totalMs = averagePreprocessMs + averageInferenceMs
    const result = {
        name: '后台模拟图片',
        iterations: STRESS_ITERATIONS,
        warmupRuns: STRESS_WARMUP_RUNS,
        inputWidth,
        inputHeight,
        preprocessMs: averagePreprocessMs,
        inferenceMs: averageInferenceMs,
        totalMs,
        fps: 1000 / totalMs,
    }
    log.info('YOLO26 stress test completed', {...result, provider: providerName()})
    return result
})

const initializeYolo26 = () => enqueueLifecycle(async () => {
    engineActive = true
    shuttingDown = false
    try {
        await getEngine()
    } catch {
        // Initialization failures are returned through engine status.
    }
    return currentStatus()
})

const releaseActiveEngine = async () => {
    try {
        await enginePromise
    } catch {
        // Initialization failure is already stored in engine state.
    }
    await inferenceQueue

    const activeEngine = engine
    engine = null
    enginePromise = null
    if (activeEngine) await activeEngine.session.release()
    return Boolean(activeEngine)
}

const resetEngine = async (target: ExecutionTarget) => {
    shuttingDown = true
    try {
        await releaseActiveEngine()
        executionTarget = target
        engineState = 'idle'
        engineMessage = ''
    } finally {
        shuttingDown = false
    }
}

const setGpuEnabled = (enabled: boolean) => enqueueLifecycle(async () => {
    if (typeof enabled !== 'boolean') throw new Error('GPU 推理开关参数无效')
    if (!engineActive) throw new Error('YOLO26 页面未激活')

    const target: ExecutionTarget = enabled ? 'gpu' : 'cpu'
    if (target === executionTarget && engine) return currentStatus()
    if (target === 'gpu' && !await isGpuAvailable()) {
        throw new Error(`当前系统的 ONNX Runtime 不支持 ${gpuProvider?.displayName ?? 'GPU 推理'}`)
    }

    log.info('YOLO26 provider switch started', {
        from: providerName(),
        to: providerName(target),
    })
    await resetEngine(target)

    try {
        await getEngine()
    } catch (error) {
        if (target === 'cpu') throw error

        const gpuError = error instanceof Error ? error.message : String(error)
        await resetEngine('cpu')
        try {
            await getEngine()
        } catch (fallbackError) {
            log.error('Failed to restore YOLO26 CPU session', fallbackError)
        }
        throw new Error(`GPU 推理开启失败，已恢复 CPU：${gpuError}`)
    }

    log.info('YOLO26 provider switch completed', {provider: providerName()})
    return currentStatus()
})

const releaseYolo26Engine = () => {
    engineActive = false
    shuttingDown = true

    return enqueueLifecycle(async () => {
        const startedAt = performance.now()
        log.info('YOLO26 engine disposal started', {
            state: engineState,
            sessionReady: Boolean(engine),
        })
        try {
            const sessionReleased = await releaseActiveEngine()
            engineState = 'idle'
            engineMessage = ''
            log.info('YOLO26 engine disposal completed', {
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                sessionReleased,
            })
        } finally {
            shuttingDown = false
        }
    })
}

const assertAuthorizedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('无权访问 YOLO26')
}

export function registerYolo26(window: BrowserWindow) {
    mainWindow = window
    if (registered) return

    registered = true
    log.info('YOLO26 IPC handlers registered')
    ipcMain.handle('yolo26:initialize', event => {
        assertAuthorizedSender(event)
        return initializeYolo26()
    })
    ipcMain.handle('yolo26:dispose', event => {
        assertAuthorizedSender(event)
        return releaseYolo26Engine()
    })
    ipcMain.handle('yolo26:get-status', event => {
        assertAuthorizedSender(event)
        return currentStatus()
    })
    ipcMain.handle('yolo26:set-gpu-enabled', (event, enabled: boolean) => {
        assertAuthorizedSender(event)
        return setGpuEnabled(enabled)
    })
    ipcMain.handle('yolo26:infer-image', (event, request: Yolo26ImageRequest) => {
        assertAuthorizedSender(event)
        return inferImage(request)
    })
    ipcMain.handle('yolo26:infer-frame', (event, request: Yolo26FrameRequest) => {
        assertAuthorizedSender(event)
        return inferFrame(request)
    })
    ipcMain.handle('yolo26:stress-test', event => {
        assertAuthorizedSender(event)
        return stressTest()
    })
}

export async function disposeYolo26() {
    await releaseYolo26Engine()
    mainWindow = null
}

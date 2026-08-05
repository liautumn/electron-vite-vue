import {app, BrowserWindow, ipcMain} from 'electron'
import {createRequire} from 'node:module'
import {availableParallelism} from 'node:os'
import path from 'node:path'
import {existsSync, readFileSync} from 'node:fs'
import type {
    SenseVoiceAudioChunk,
    SenseVoiceEngineState,
    MicrophonePermissionStatus,
    SenseVoiceRecognitionResult,
    SenseVoiceStatus,
} from '../../../shared/types/sensevoice'
import {createLogger} from '../utils/logger'
import {requestMediaAccess} from '../utils/media-access'
import {resolvePortablePath} from '../utils/portable-path'

const TARGET_SAMPLE_RATE = 16_000
const PARTIAL_INTERVAL_SAMPLES = TARGET_SAMPLE_RATE
const SILENCE_TO_COMMIT_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.9)
const MAX_UTTERANCE_SAMPLES = TARGET_SAMPLE_RATE * 25
const LEADING_CONTEXT_SAMPLES = TARGET_SAMPLE_RATE
const SILENCE_RMS_THRESHOLD = 0.007

type OfflineStream = {
    acceptWaveform(input: {sampleRate: number; samples: Float32Array}): void
}

type OfflineRecognizer = {
    createStream(): OfflineStream
    decodeAsync(stream: OfflineStream): Promise<{text?: string}>
}

type OfflineRecognizerConstructor = {
    createAsync(config: Record<string, unknown>): Promise<OfflineRecognizer>
}

type LinearResampler = {
    resample(samples: Float32Array): Float32Array
    flush(samples: Float32Array): Float32Array
}

type SherpaOnnxModule = {
    OfflineRecognizer: OfflineRecognizerConstructor
    LinearResampler: new (inputSampleRate: number, outputSampleRate: number) => LinearResampler
}

type DecodeRequest = {
    sessionId: number
    segmentId: number
    kind: 'partial' | 'final'
    samples: Float32Array
}

type SenseVoiceConfig = {
    modelPath?: unknown
    tokensPath?: unknown
}

type ResolvedModelConfig = {
    configPath: string
    modelPath: string
    tokensPath: string
    error?: string
}

const require = createRequire(import.meta.url)
const log = createLogger('sensevoice')

let mainWindow: BrowserWindow | null = null
let registered = false
let recognizer: OfflineRecognizer | null = null
let recognizerPromise: Promise<OfflineRecognizer> | null = null
let resampler: LinearResampler | null = null
let recording = false
let sessionId = 0
let segmentId = 0
let activeAudio = new Float32Array()
let speechSeen = false
let silenceSamples = 0
let samplesSinceDecode = 0
let decodeQueue: DecodeRequest[] = []
let decoding = false
let drainResolvers: Array<() => void> = []

const loadSherpaOnnx = () => require('sherpa-onnx-node') as SherpaOnnxModule

const sendToRenderer = (channel: string, payload: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
}

const defaultConfigPath = () => path.join(
    app.isPackaged ? process.resourcesPath : process.env.APP_ROOT ?? process.cwd(),
    'config',
    'sensevoice.json'
)

const getConfigPath = () => {
    const configuredPath = process.env.SENSEVOICE_CONFIG_PATH?.trim()
    return configuredPath ? path.resolve(configuredPath) : defaultConfigPath()
}

const resolveModelConfig = (): ResolvedModelConfig => {
    const configPath = getConfigPath()
    if (!existsSync(configPath)) {
        return {
            configPath,
            modelPath: '',
            tokensPath: '',
            error: `SenseVoice 配置文件不存在：${configPath}`,
        }
    }

    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8')) as SenseVoiceConfig
        const directory = path.dirname(configPath)
        const pathOptions = {
            configDirectory: directory,
            userDataDirectory: app.getPath('userData'),
        }
        const modelPath = resolvePortablePath(config.modelPath, pathOptions)
        const tokensPath = resolvePortablePath(config.tokensPath, pathOptions)

        if (!modelPath || !tokensPath) {
            return {
                configPath,
                modelPath,
                tokensPath,
                error: 'SenseVoice 配置必须指定 modelPath 和 tokensPath',
            }
        }

        const missingFiles = [modelPath, tokensPath].filter(file => !existsSync(file))
        return {
            configPath,
            modelPath,
            tokensPath,
            ...(missingFiles.length
                ? {error: `SenseVoice 文件不存在：${missingFiles.join('、')}`}
                : {}),
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {
            configPath,
            modelPath: '',
            tokensPath: '',
            error: `SenseVoice 配置读取失败：${detail}`,
        }
    }
}

const currentStatus = (
    state?: SenseVoiceEngineState,
    message?: string
): SenseVoiceStatus => {
    const modelConfig = resolveModelConfig()
    const modelAvailable = !modelConfig.error
    const resolvedState = state ?? (
        recording
            ? 'recording'
            : modelAvailable
                ? 'ready'
                : 'missing'
    )

    return {
        state: resolvedState,
        modelAvailable,
        engineReady: Boolean(recognizer),
        configPath: modelConfig.configPath,
        modelPath: modelConfig.modelPath,
        tokensPath: modelConfig.tokensPath,
        ...(message || modelConfig.error ? {message: message ?? modelConfig.error} : {}),
    }
}

const publishStatus = (state?: SenseVoiceEngineState, message?: string) => {
    const status = currentStatus(state, message)
    sendToRenderer('sensevoice:status', status)
    return status
}

const publishError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    log.error('SenseVoice error', error)
    sendToRenderer('sensevoice:error', message)
    publishStatus('error', message)
}

const getRecognizer = async () => {
    if (recognizer) return recognizer
    if (recognizerPromise) return recognizerPromise

    const modelConfig = resolveModelConfig()
    if (modelConfig.error) throw new Error(modelConfig.error)

    publishStatus('loading', '正在加载本地识别引擎')
    recognizerPromise = (async () => {
        const sherpaOnnx = loadSherpaOnnx()
        const numThreads = Math.max(1, Math.min(4, availableParallelism()))
        const engine = await sherpaOnnx.OfflineRecognizer.createAsync({
            featConfig: {
                sampleRate: TARGET_SAMPLE_RATE,
                featureDim: 80,
            },
            modelConfig: {
                senseVoice: {
                    model: modelConfig.modelPath,
                    language: 'zh',
                    useInverseTextNormalization: 1,
                },
                tokens: modelConfig.tokensPath,
                numThreads,
                provider: 'cpu',
                debug: 0,
            },
        })
        recognizer = engine
        log.info('SenseVoice engine loaded', {
            modelPath: modelConfig.modelPath,
            tokensPath: modelConfig.tokensPath,
            numThreads,
        })
        publishStatus(recording ? 'recording' : 'ready')
        return engine
    })().catch(error => {
        recognizerPromise = null
        publishError(error)
        throw error
    })

    return recognizerPromise
}

const appendSamples = (left: Float32Array, right: Float32Array) => {
    const output = new Float32Array(left.length + right.length)
    output.set(left)
    output.set(right, left.length)
    return output
}

const normalizeRecognitionText = (text: string) =>
    text.trim().replace(/[。.．]+$/u, '')

const resetUtterance = () => {
    activeAudio = new Float32Array()
    speechSeen = false
    silenceSamples = 0
    samplesSinceDecode = 0
}

const resetSession = () => {
    sessionId += 1
    segmentId = 0
    decodeQueue = []
    resetUtterance()
}

const finishDrain = () => {
    const resolvers = drainResolvers
    drainResolvers = []
    resolvers.forEach(resolve => resolve())
}

const decodeAudio = async (request: DecodeRequest) => {
    const engine = await getRecognizer()
    const stream = engine.createStream()
    stream.acceptWaveform({sampleRate: TARGET_SAMPLE_RATE, samples: request.samples})
    const startedAt = performance.now()
    const result = await engine.decodeAsync(stream)
    const inferenceMs = Math.round(performance.now() - startedAt)

    if (request.sessionId !== sessionId) return

    const payload: SenseVoiceRecognitionResult = {
        kind: request.kind,
        text: normalizeRecognitionText(result.text ?? ''),
        segmentId: request.segmentId,
        audioDurationMs: Math.round(request.samples.length / TARGET_SAMPLE_RATE * 1000),
        inferenceMs,
        timestamp: new Date().toISOString(),
    }
    sendToRenderer('sensevoice:result', payload)
}

const drainDecodeQueue = async () => {
    if (decoding) return
    decoding = true
    try {
        while (decodeQueue.length) {
            const request = decodeQueue.shift()
            if (!request || request.sessionId !== sessionId) continue
            try {
                await decodeAudio(request)
            } catch (error) {
                publishError(error)
            }
        }
    } finally {
        decoding = false
        finishDrain()
    }
}

const enqueueDecode = (kind: DecodeRequest['kind'], samples: Float32Array, id: number) => {
    if (!samples.length) return

    decodeQueue = decodeQueue.filter(request => !(
        request.sessionId === sessionId &&
        request.segmentId === id &&
        request.kind === 'partial'
    ))
    decodeQueue.push({
        sessionId,
        segmentId: id,
        kind,
        samples: samples.slice(),
    })
    void drainDecodeQueue()
}

const waitForDecodeDrain = () => {
    if (!decoding && decodeQueue.length === 0) return Promise.resolve()
    return new Promise<void>(resolve => drainResolvers.push(resolve))
}

const acceptResampledAudio = (samples: Float32Array) => {
    if (!samples.length) return

    activeAudio = appendSamples(activeAudio, samples)
    samplesSinceDecode += samples.length

    let squareSum = 0
    for (const sample of samples) squareSum += sample * sample
    const rms = Math.sqrt(squareSum / samples.length)

    if (rms >= SILENCE_RMS_THRESHOLD) {
        speechSeen = true
        silenceSamples = 0
    } else if (speechSeen) {
        silenceSamples += samples.length
    }

    if (!speechSeen) {
        if (activeAudio.length > LEADING_CONTEXT_SAMPLES) {
            activeAudio = activeAudio.slice(-LEADING_CONTEXT_SAMPLES)
        }
        return
    }

    const shouldCommit =
        silenceSamples >= SILENCE_TO_COMMIT_SAMPLES ||
        activeAudio.length >= MAX_UTTERANCE_SAMPLES

    if (shouldCommit) {
        const completedAudio = activeAudio
        const completedSegmentId = segmentId
        segmentId += 1
        resetUtterance()
        enqueueDecode('final', completedAudio, completedSegmentId)
        return
    }

    if (samplesSinceDecode >= PARTIAL_INTERVAL_SAMPLES) {
        samplesSinceDecode = 0
        enqueueDecode('partial', activeAudio, segmentId)
    }
}

const acceptAudio = (chunk: SenseVoiceAudioChunk) => {
    if (!recording || !Number.isFinite(chunk.sampleRate) || chunk.sampleRate <= 0) return
    if (!(chunk.samples instanceof Float32Array) || chunk.samples.length === 0) return
    if (chunk.samples.length > chunk.sampleRate * 2) return

    const normalized = resampler ? resampler.resample(chunk.samples) : chunk.samples
    acceptResampledAudio(normalized)
}

const startRecording = async (inputSampleRate: number) => {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate < 8_000 || inputSampleRate > 192_000) {
        throw new Error(`不支持的麦克风采样率：${inputSampleRate}`)
    }

    await getRecognizer()
    const sherpaOnnx = loadSherpaOnnx()
    resetSession()
    resampler = inputSampleRate === TARGET_SAMPLE_RATE
        ? null
        : new sherpaOnnx.LinearResampler(inputSampleRate, TARGET_SAMPLE_RATE)
    recording = true
    log.info('SenseVoice recording started', {inputSampleRate})
    return publishStatus('recording')
}

const stopRecording = async () => {
    if (!recording) return currentStatus()
    recording = false

    if (resampler) {
        acceptResampledAudio(resampler.flush(new Float32Array()))
        resampler = null
    }
    if (speechSeen && activeAudio.length) {
        const completedAudio = activeAudio
        const completedSegmentId = segmentId
        segmentId += 1
        resetUtterance()
        enqueueDecode('final', completedAudio, completedSegmentId)
    }

    await waitForDecodeDrain()
    log.info('SenseVoice recording stopped')
    return publishStatus('ready')
}

const clearRecognition = async () => {
    const modelConfig = resolveModelConfig()
    const nextState: SenseVoiceEngineState = recording
        ? 'recording'
        : !modelConfig.error
            ? 'ready'
            : 'missing'
    resetSession()
    await waitForDecodeDrain()
    log.info('SenseVoice recognition cleared', {recording})
    return publishStatus(nextState)
}

export function registerSenseVoice(window: BrowserWindow) {
    mainWindow = window
    if (registered) return
    registered = true
    log.info('SenseVoice IPC handlers registered')

    ipcMain.handle('sensevoice:request-microphone-access', async event => {
        if (event.sender !== mainWindow?.webContents) return 'denied'
        const status: MicrophonePermissionStatus = await requestMediaAccess('microphone')
        log.info('Microphone access requested', {platform: process.platform, status})
        return status
    })
    ipcMain.handle('sensevoice:get-status', () => currentStatus())
    ipcMain.handle('sensevoice:start', (_event, sampleRate: number) => startRecording(sampleRate))
    ipcMain.handle('sensevoice:stop', () => stopRecording())
    ipcMain.handle('sensevoice:reset', () => clearRecognition())
    ipcMain.on('sensevoice:audio', (event, chunk: SenseVoiceAudioChunk) => {
        if (event.sender !== mainWindow?.webContents) return
        acceptAudio(chunk)
    })
}

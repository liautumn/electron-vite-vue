import {app, BrowserWindow, ipcMain, net} from 'electron'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {availableParallelism} from 'node:os'
import path from 'node:path'
import {existsSync, promises as fs} from 'node:fs'
import type {
    SenseVoiceAudioChunk,
    SenseVoiceDownloadProgress,
    SenseVoiceEngineState,
    SenseVoiceRecognitionResult,
    SenseVoiceStatus,
} from '../../../shared/types/sensevoice'
import {createLogger} from '../utils/logger'

const MODEL_ARCHIVE_URL =
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/' +
    'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2'
const MODEL_ARCHIVE_BYTES = 163_002_883
const MODEL_FILE = 'model.int8.onnx'
const TOKENS_FILE = 'tokens.txt'
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
let modelDownloadPromise: Promise<SenseVoiceStatus> | null = null

const loadSherpaOnnx = () => require('sherpa-onnx-node') as SherpaOnnxModule

const sendToRenderer = (channel: string, payload: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
}

const modelFilesExist = (directory: string) =>
    existsSync(path.join(directory, MODEL_FILE)) && existsSync(path.join(directory, TOKENS_FILE))

const userModelDirectory = () => path.join(app.getPath('userData'), 'models', 'sensevoice-int8')

const modelCandidates = () => {
    const candidates = [
        process.env.SENSEVOICE_ONNX_MODEL_DIR,
        userModelDirectory(),
        app.isPackaged ? path.join(process.resourcesPath, 'sensevoice') : undefined,
        !app.isPackaged && process.env.APP_ROOT
            ? path.join(process.env.APP_ROOT, 'resources', 'sensevoice')
            : undefined,
    ]
    return candidates.filter((candidate): candidate is string => Boolean(candidate))
}

const resolveModelDirectory = () => modelCandidates().find(modelFilesExist)

const currentStatus = (
    state?: SenseVoiceEngineState,
    message?: string
): SenseVoiceStatus => {
    const modelDirectory = resolveModelDirectory()
    const resolvedState = state ?? (
        modelDownloadPromise
            ? 'downloading'
            : recording
                ? 'recording'
                : modelDirectory
                    ? 'ready'
                    : 'missing'
    )

    return {
        state: resolvedState,
        modelAvailable: Boolean(modelDirectory),
        engineReady: Boolean(recognizer),
        modelDirectory: modelDirectory ?? userModelDirectory(),
        ...(message ? {message} : {}),
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

const publishDownloadProgress = (
    stage: SenseVoiceDownloadProgress['stage'],
    receivedBytes: number,
    totalBytes: number
) => {
    const progress: SenseVoiceDownloadProgress = {
        stage,
        receivedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Math.min(receivedBytes / totalBytes, 1) : 0,
    }
    sendToRenderer('sensevoice:download-progress', progress)
}

const runTar = (archive: string, destination: string) =>
    new Promise<void>((resolve, reject) => {
        const child = spawn('tar', [
            '-xjf', archive,
            '-C', destination,
            '--strip-components=1',
        ], {stdio: ['ignore', 'ignore', 'pipe']})
        let stderr = ''
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', chunk => {
            stderr += chunk
        })
        child.once('error', reject)
        child.once('close', code => {
            if (code === 0) {
                resolve()
                return
            }
            reject(new Error(`模型解压失败（tar ${code}）：${stderr.trim()}`))
        })
    })

const downloadArchive = async (destination: string) => {
    const response = await net.fetch(MODEL_ARCHIVE_URL)
    if (!response.ok || !response.body) {
        throw new Error(`模型下载失败：HTTP ${response.status}`)
    }

    const totalBytes = Number(response.headers.get('content-length')) || MODEL_ARCHIVE_BYTES
    const reader = response.body.getReader()
    const output = await fs.open(destination, 'w')
    let receivedBytes = 0

    try {
        while (true) {
            const {done, value} = await reader.read()
            if (done) break
            await output.write(value)
            receivedBytes += value.byteLength
            publishDownloadProgress('download', receivedBytes, totalBytes)
        }
    } finally {
        await output.close()
    }
}

const performModelDownload = async () => {
    const existing = resolveModelDirectory()
    if (existing) return publishStatus('ready')

    publishStatus('downloading', '正在下载 SenseVoice int8 模型')
    const target = userModelDirectory()
    const parent = path.dirname(target)
    const nonce = `${process.pid}-${Date.now()}`
    const archive = path.join(app.getPath('temp'), `sensevoice-${nonce}.tar.bz2`)
    const staging = path.join(parent, `.sensevoice-int8-${nonce}`)

    try {
        await fs.mkdir(staging, {recursive: true})
        await downloadArchive(archive)
        publishDownloadProgress('extract', MODEL_ARCHIVE_BYTES, MODEL_ARCHIVE_BYTES)
        await runTar(archive, staging)

        if (!modelFilesExist(staging)) {
            throw new Error('模型压缩包缺少 model.int8.onnx 或 tokens.txt')
        }

        await fs.mkdir(parent, {recursive: true})
        await fs.rm(target, {recursive: true, force: true})
        await fs.rename(staging, target)
        publishDownloadProgress('complete', MODEL_ARCHIVE_BYTES, MODEL_ARCHIVE_BYTES)
        log.info('SenseVoice model downloaded', {target})
        return publishStatus('ready', '模型已就绪')
    } catch (error) {
        publishError(error)
        throw error
    } finally {
        await fs.rm(archive, {force: true}).catch(() => undefined)
        await fs.rm(staging, {recursive: true, force: true}).catch(() => undefined)
    }
}

const downloadModel = () => {
    if (!modelDownloadPromise) {
        modelDownloadPromise = performModelDownload().finally(() => {
            modelDownloadPromise = null
        })
    }
    return modelDownloadPromise
}

const getRecognizer = async () => {
    if (recognizer) return recognizer
    if (recognizerPromise) return recognizerPromise

    const modelDirectory = resolveModelDirectory()
    if (!modelDirectory) throw new Error('SenseVoice 模型尚未下载')

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
                    model: path.join(modelDirectory, MODEL_FILE),
                    language: 'zh',
                    useInverseTextNormalization: 1,
                },
                tokens: path.join(modelDirectory, TOKENS_FILE),
                numThreads,
                provider: 'cpu',
                debug: 0,
            },
        })
        recognizer = engine
        log.info('SenseVoice engine loaded', {modelDirectory, numThreads})
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
    const nextState: SenseVoiceEngineState = recording
        ? 'recording'
        : resolveModelDirectory()
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

    ipcMain.handle('sensevoice:get-status', () => currentStatus())
    ipcMain.handle('sensevoice:download-model', () => downloadModel())
    ipcMain.handle('sensevoice:start', (_event, sampleRate: number) => startRecording(sampleRate))
    ipcMain.handle('sensevoice:stop', () => stopRecording())
    ipcMain.handle('sensevoice:reset', () => clearRecognition())
    ipcMain.on('sensevoice:audio', (event, chunk: SenseVoiceAudioChunk) => {
        if (event.sender !== mainWindow?.webContents) return
        acceptAudio(chunk)
    })
}

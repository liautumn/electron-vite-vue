import {computed, onMounted, onScopeDispose, readonly, ref, shallowRef} from 'vue'
import type {CameraMethods, CameraPermissionStatus} from '../types/camera'
import type {RgbaImage} from '../types/image'

export type CameraState = 'idle' | 'starting' | 'running' | 'error'

export interface CameraFrameSize {
    width: number
    height: number
}

export interface UseCameraOptions {
    maxFrameEdge?: number
    idealWidth?: number
    idealHeight?: number
}

const DEFAULT_MAX_FRAME_EDGE = 640
const DEFAULT_IDEAL_WIDTH = 1280
const DEFAULT_IDEAL_HEIGHT = 720
const FALLBACK_FRAME_SIZE: CameraFrameSize = {width: 16, height: 9}

const positiveInteger = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) && Number(value) > 0 ? Math.max(1, Math.floor(Number(value))) : fallback

const toCameraErrorMessage = (error: unknown) => {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return '摄像头权限被拒绝'
    if (error instanceof DOMException && error.name === 'NotFoundError') return '未检测到可用的摄像头'
    if (error instanceof DOMException && error.name === 'NotReadableError') return '摄像头无法读取，可能正被其他应用占用'
    if (error instanceof DOMException && error.name === 'OverconstrainedError') return '选择的摄像头当前不可用'
    return error instanceof Error ? error.message : String(error)
}

const permissionError = (status: CameraPermissionStatus) => {
    if (status === 'denied') return new Error('摄像头权限被拒绝，请在系统设置中允许后重启应用')
    if (status === 'restricted') return new Error('摄像头访问受到系统限制')
    return null
}

const cameraBridge = () => {
    const bridge = (window as Window & {camera?: CameraMethods}).camera
    if (!bridge) throw new Error('摄像头权限接口不可用')
    return bridge
}

export function useCamera(options: UseCameraOptions = {}) {
    const maxFrameEdge = positiveInteger(options.maxFrameEdge, DEFAULT_MAX_FRAME_EDGE)
    const idealWidth = positiveInteger(options.idealWidth, DEFAULT_IDEAL_WIDTH)
    const idealHeight = positiveInteger(options.idealHeight, DEFAULT_IDEAL_HEIGHT)

    const state = ref<CameraState>('idle')
    const devices = shallowRef<MediaDeviceInfo[]>([])
    const selectedDeviceId = ref<string | null>(null)
    const frameSize = ref<CameraFrameSize>({...FALLBACK_FRAME_SIZE})
    const error = ref('')
    const videoRef = ref<HTMLVideoElement | null>(null)

    const isRunning = computed(() => state.value === 'running')
    const isStarting = computed(() => state.value === 'starting')

    let stream: MediaStream | null = null
    let attachedVideo: HTMLVideoElement | null = null
    let captureCanvas: HTMLCanvasElement | null = null
    let captureContext: CanvasRenderingContext2D | null = null
    let lifecycleGeneration = 0
    let deviceRefreshGeneration = 0
    let disposed = false

    const mediaDevices = () => {
        const value = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
        if (!value?.getUserMedia || !value.enumerateDevices) {
            throw new Error('当前环境不支持摄像头')
        }
        return value
    }

    const releaseResources = () => {
        const activeStream = stream
        const video = attachedVideo
        stream = null
        attachedVideo = null

        activeStream?.getTracks().forEach(track => track.stop())
        if (video) {
            video.pause()
            video.srcObject = null
        }
    }

    const stop = () => {
        lifecycleGeneration += 1
        releaseResources()
        error.value = ''
        state.value = 'idle'
    }

    const fail = (generation: number, message: string) => {
        if (generation !== lifecycleGeneration || disposed) return
        lifecycleGeneration += 1
        releaseResources()
        error.value = message
        state.value = 'error'
    }

    const refreshDevices = async () => {
        if (disposed) return
        const refreshGeneration = ++deviceRefreshGeneration
        try {
            const nextDevices = (await mediaDevices().enumerateDevices())
                .filter(device => device.kind === 'videoinput')
            if (disposed || refreshGeneration !== deviceRefreshGeneration) return

            devices.value = nextDevices
            if (!nextDevices.some(device => device.deviceId === selectedDeviceId.value)) {
                selectedDeviceId.value = nextDevices[0]?.deviceId ?? null
            }
        } catch (cause) {
            if (!disposed && refreshGeneration === deviceRefreshGeneration && state.value !== 'running') {
                error.value = toCameraErrorMessage(cause)
            }
            throw cause
        }
    }

    const start = async () => {
        if (disposed || state.value === 'starting' || state.value === 'running') return false

        const generation = ++lifecycleGeneration
        const video = videoRef.value
        state.value = 'starting'
        error.value = ''
        let pendingStream: MediaStream | null = null

        try {
            if (!video) throw new Error('摄像头预览组件尚未就绪')

            const permission = await cameraBridge().requestAccess()
            if (generation !== lifecycleGeneration || disposed) return false
            const accessError = permissionError(permission)
            if (accessError) throw accessError

            const selectedId = selectedDeviceId.value
            pendingStream = await mediaDevices().getUserMedia({
                audio: false,
                video: {
                    deviceId: selectedId ? {exact: selectedId} : undefined,
                    width: {ideal: idealWidth},
                    height: {ideal: idealHeight},
                },
            })
            if (generation !== lifecycleGeneration || disposed) {
                pendingStream.getTracks().forEach(track => track.stop())
                return false
            }

            const activeStream = pendingStream
            pendingStream = null
            stream = activeStream
            attachedVideo = video
            video.srcObject = activeStream

            activeStream.getVideoTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    if (generation === lifecycleGeneration && stream === activeStream) {
                        fail(generation, '摄像头连接已断开')
                    }
                }, {once: true})
            })

            await video.play()
            if (generation !== lifecycleGeneration || disposed) return false

            const settings = activeStream.getVideoTracks()[0]?.getSettings()
            frameSize.value = {
                width: video.videoWidth || settings?.width || FALLBACK_FRAME_SIZE.width,
                height: video.videoHeight || settings?.height || FALLBACK_FRAME_SIZE.height,
            }
            state.value = 'running'
            void refreshDevices().catch(() => undefined)
            return true
        } catch (cause) {
            pendingStream?.getTracks().forEach(track => track.stop())
            if (generation === lifecycleGeneration && !disposed) {
                fail(generation, toCameraErrorMessage(cause))
            }
            return false
        }
    }

    const captureFrame = (): RgbaImage | null => {
        const video = attachedVideo
        if (state.value !== 'running' || !stream?.active || !video
            || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            || !video.videoWidth || !video.videoHeight) {
            return null
        }

        try {
            if (!captureCanvas) captureCanvas = document.createElement('canvas')
            if (!captureContext) {
                captureContext = captureCanvas.getContext('2d', {willReadFrequently: true})
            }
            if (!captureContext) throw new Error('无法创建摄像头取帧画布')

            const scale = Math.min(1, maxFrameEdge / Math.max(video.videoWidth, video.videoHeight))
            const width = Math.max(1, Math.round(video.videoWidth * scale))
            const height = Math.max(1, Math.round(video.videoHeight * scale))
            if (captureCanvas.width !== width || captureCanvas.height !== height) {
                captureCanvas.width = width
                captureCanvas.height = height
            }

            captureContext.drawImage(video, 0, 0, width, height)
            const imageData = captureContext.getImageData(0, 0, width, height)
            return {
                pixelFormat: 'rgba8',
                width,
                height,
                pixels: new Uint8Array(
                    imageData.data.buffer,
                    imageData.data.byteOffset,
                    imageData.data.byteLength
                ),
            }
        } catch (cause) {
            fail(lifecycleGeneration, toCameraErrorMessage(cause))
            return null
        }
    }

    const handleDeviceChange = () => {
        void refreshDevices().catch(() => undefined)
    }

    onMounted(() => {
        const availableMediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
        availableMediaDevices?.addEventListener('devicechange', handleDeviceChange)
        handleDeviceChange()
    })

    onScopeDispose(() => {
        disposed = true
        deviceRefreshGeneration += 1
        const availableMediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
        availableMediaDevices?.removeEventListener('devicechange', handleDeviceChange)
        lifecycleGeneration += 1
        releaseResources()
        captureContext = null
        captureCanvas = null
        state.value = 'idle'
    })

    return {
        state: readonly(state),
        devices: readonly(devices),
        selectedDeviceId,
        frameSize: readonly(frameSize),
        error: readonly(error),
        videoRef,
        isRunning,
        isStarting,
        refreshDevices,
        start,
        stop,
        captureFrame,
    }
}

export type CameraSource = ReturnType<typeof useCamera>

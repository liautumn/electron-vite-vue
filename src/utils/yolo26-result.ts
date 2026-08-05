import type {Yolo26Detection, Yolo26InferenceResult} from '../types/yolo26'

export const YOLO26_DETECTION_COLORS = [
    '#3b82f6',
    '#ef4444',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#06b6d4',
    '#ec4899',
    '#84cc16',
] as const

const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,'
const MAX_RESULT_PREVIEW_EDGE = 2048

const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum)

export const detectionColor = (detection: Pick<Yolo26Detection, 'classId'>) => {
    const classId = Number.isFinite(detection.classId) ? Math.trunc(detection.classId) : 0
    const index = ((classId % YOLO26_DETECTION_COLORS.length) + YOLO26_DETECTION_COLORS.length)
        % YOLO26_DETECTION_COLORS.length
    return YOLO26_DETECTION_COLORS[index]
}

const loadImage = (sourceUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
        reject(new Error('YOLO26 source image URL is empty'))
        return
    }

    const image = new Image()
    const clearHandlers = () => {
        image.onload = null
        image.onerror = null
    }

    image.onload = () => {
        clearHandlers()
        if (!image.naturalWidth || !image.naturalHeight) {
            reject(new Error('YOLO26 source image has invalid dimensions'))
            return
        }
        resolve(image)
    }
    image.onerror = () => {
        clearHandlers()
        reject(new Error('Failed to load YOLO26 source image'))
    }
    image.src = sourceUrl
})

const drawDetections = (
    context: CanvasRenderingContext2D,
    result: Yolo26InferenceResult,
    scale: number,
    width: number,
    height: number
) => {
    const lineWidth = Math.max(2, Math.round(Math.min(width, height) / 320))
    const fontSize = Math.max(12, Math.round(Math.min(width, height) / 35))
    const labelHeight = fontSize + 8
    const labelPadding = 6

    context.lineWidth = lineWidth
    context.font = `600 ${fontSize}px Arial, sans-serif`
    context.textBaseline = 'middle'

    result.detections.forEach(detection => {
        if (detection.box.some(value => !Number.isFinite(value))) return

        const [rawX1, rawY1, rawX2, rawY2] = detection.box
        const x1 = clamp(rawX1 * scale, 0, width)
        const y1 = clamp(rawY1 * scale, 0, height)
        const x2 = clamp(rawX2 * scale, 0, width)
        const y2 = clamp(rawY2 * scale, 0, height)
        if (x2 <= x1 || y2 <= y1) return

        const color = detectionColor(detection)
        const confidence = Number.isFinite(detection.confidence) ? detection.confidence : 0
        const label = `${detection.className} ${(confidence * 100).toFixed(0)}%`
        const labelWidth = Math.min(width - x1, context.measureText(label).width + labelPadding * 2)
        const labelY = Math.max(0, y1 - labelHeight)

        context.strokeStyle = color
        context.strokeRect(x1, y1, x2 - x1, y2 - y1)
        context.fillStyle = color
        context.fillRect(x1, labelY, labelWidth, labelHeight)
        context.fillStyle = '#ffffff'
        context.fillText(
            label,
            x1 + labelPadding,
            labelY + labelHeight / 2,
            Math.max(1, labelWidth - labelPadding * 2)
        )
    })
}

export async function renderYolo26Result(
    sourceUrl: string,
    result: Yolo26InferenceResult
): Promise<string> {
    if (!Number.isInteger(result?.width) || !Number.isInteger(result?.height)
        || result.width <= 0 || result.height <= 0) {
        throw new Error('YOLO26 result has invalid image dimensions')
    }

    const image = await loadImage(sourceUrl)
    const scale = Math.min(1, MAX_RESULT_PREVIEW_EDGE / Math.max(result.width, result.height))
    const width = Math.max(1, Math.round(result.width * scale))
    const height = Math.max(1, Math.round(result.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    let context: CanvasRenderingContext2D | null
    try {
        context = canvas.getContext('2d')
    } catch (error) {
        throw new Error('Failed to create Canvas 2D context for YOLO26 result', {cause: error})
    }
    if (!context) throw new Error('Failed to create Canvas 2D context for YOLO26 result')

    try {
        context.drawImage(image, 0, 0, width, height)
        drawDetections(context, result, scale, width, height)
    } catch (error) {
        throw new Error('Failed to draw YOLO26 result', {cause: error})
    }

    let rendered: string
    try {
        rendered = canvas.toDataURL('image/jpeg', 0.9)
    } catch (error) {
        throw new Error('Failed to encode YOLO26 result as JPEG', {cause: error})
    }
    if (!rendered.startsWith(JPEG_DATA_URL_PREFIX)) {
        throw new Error('Canvas did not produce a JPEG data URL')
    }
    return rendered
}

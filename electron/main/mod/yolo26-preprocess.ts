import type * as ort from 'onnxruntime-node'

export type Yolo26PixelImage = {
    pixels: Uint8Array
    width: number
    height: number
    channels: 3 | 4
}

export type Yolo26PreprocessedImage = {
    width: number
    height: number
    gain: number
    padX: number
    padY: number
    tensor: ort.Tensor
}

type OpenCvRuntime = typeof import('@techstark/opencv-js') & {
    onRuntimeInitialized?: () => void
}

let openCvPromise: Promise<OpenCvRuntime> | null = null

export const getOpenCv = () => {
    if (openCvPromise) return openCvPromise

    openCvPromise = import('@techstark/opencv-js')
        .then(imported => (
            'default' in imported ? imported.default : imported
        ) as OpenCvRuntime | PromiseLike<OpenCvRuntime>)
        .then(runtime => Promise.resolve(runtime))
        .then(runtime => {
            if (runtime.Mat) return runtime
            return new Promise<OpenCvRuntime>(resolve => {
                runtime.onRuntimeInitialized = () => resolve(runtime)
            })
        })
    return openCvPromise
}

export async function preprocessYolo26(
    image: Yolo26PixelImage,
    inputHeight: number,
    inputWidth: number
): Promise<Yolo26PreprocessedImage> {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
        throw new Error('无法读取图片尺寸')
    }
    if (image.pixels.byteLength !== image.width * image.height * image.channels) {
        throw new Error('图片像素数据长度与尺寸不匹配')
    }

    const [cv, ortRuntime] = await Promise.all([
        getOpenCv(),
        import('onnxruntime-node'),
    ])
    const gain = Math.min(inputHeight / image.height, inputWidth / image.width)
    const resizedWidth = Math.round(image.width * gain)
    const resizedHeight = Math.round(image.height * gain)
    const padX = Math.round((inputWidth - resizedWidth) / 2 - 0.1)
    const padY = Math.round((inputHeight - resizedHeight) / 2 - 0.1)
    const right = inputWidth - resizedWidth - padX
    const bottom = inputHeight - resizedHeight - padY

    const source = new cv.Mat(
        image.height,
        image.width,
        image.channels === 4 ? cv.CV_8UC4 : cv.CV_8UC3
    )
    const rgb = new cv.Mat()
    const resized = new cv.Mat()
    const padded = new cv.Mat()
    let blob: InstanceType<typeof cv.Mat> | null = null

    try {
        source.data.set(image.pixels)
        if (image.channels === 4) {
            cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB)
        } else {
            source.copyTo(rgb)
        }
        cv.resize(rgb, resized, new cv.Size(resizedWidth, resizedHeight), 0, 0, cv.INTER_LINEAR)
        cv.copyMakeBorder(
            resized,
            padded,
            padY,
            bottom,
            padX,
            right,
            cv.BORDER_CONSTANT,
            new cv.Scalar(114, 114, 114, 0)
        )
        blob = cv.blobFromImage(
            padded,
            1 / 255,
            new cv.Size(inputWidth, inputHeight),
            new cv.Scalar(0, 0, 0, 0),
            false,
            false,
            cv.CV_32F
        )

        const tensorData = new Float32Array(blob.data32F)
        return {
            width: image.width,
            height: image.height,
            gain,
            padX,
            padY,
            tensor: new ortRuntime.Tensor('float32', tensorData, [1, 3, inputHeight, inputWidth]),
        }
    } finally {
        blob?.delete()
        padded.delete()
        resized.delete()
        rgb.delete()
        source.delete()
    }
}

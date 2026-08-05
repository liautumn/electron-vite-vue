export interface EncodedImage {
    bytes: Uint8Array
}

export interface RgbaImage {
    pixelFormat: 'rgba8'
    width: number
    height: number
    pixels: Uint8Array
}

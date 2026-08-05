import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, it} from 'node:test'
import ts from 'typescript'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readProjectFile = (filePath: string) => readFileSync(path.join(projectRoot, filePath), 'utf8')

describe('YOLO26 module boundaries', () => {
    it('keeps camera and file workflows outside the detector API', () => {
        const sharedContract = readProjectFile('shared/types/yolo26.ts')
        const mainModule = readProjectFile('electron/main/mod/yolo26.ts')
        const preloadModule = readProjectFile('electron/preload/mod/yolo26.ts')

        assert.doesNotMatch(sharedContract, /camera|requestAccess|selectImages|downloadResult/i)
        assert.doesNotMatch(mainModule, /media-access|image-files|\bdialog\b|selectImages|downloadResult/i)
        assert.doesNotMatch(preloadModule, /camera|image-files|selectImages|downloadResult/i)
        assert.match(sharedContract, /inferImage\(request: Yolo26ImageRequest\)/)
        assert.match(sharedContract, /inferFrame\(request: Yolo26FrameRequest\)/)
    })

    it('keeps frame acquisition independent from YOLO26', () => {
        const cameraSource = readProjectFile('src/composables/useCamera.ts')
        const cameraMain = readProjectFile('electron/main/mod/camera.ts')

        assert.doesNotMatch(cameraSource, /yolo26/i)
        assert.doesNotMatch(cameraMain, /yolo26/i)
        assert.match(cameraSource, /captureFrame = \(\): RgbaImage/)
        assert.match(cameraSource, /pixelFormat: 'rgba8'/)
    })

    it('composes image and camera inputs only in the business view', () => {
        const view = readProjectFile('src/views/Yolo26DemoView.vue')

        assert.match(view, /window\.imageFiles\.read\(item\.path\)/)
        assert.match(view, /window\.yolo26\.inferImage\(/)
        assert.match(view, /const frame = captureCameraFrame\(\)/)
        assert.match(view, /window\.yolo26\.inferFrame\(/)
    })

    it('packages the model referenced by the runtime configuration', () => {
        const config = JSON.parse(readProjectFile('config/yolo26.json')) as {modelPath: string}
        const builderPath = path.join(projectRoot, 'electron-builder.json5')
        const parsedBuilder = ts.parseConfigFileTextToJson(builderPath, readFileSync(builderPath, 'utf8'))
        assert.equal(parsedBuilder.error, undefined)

        const builder = parsedBuilder.config as {
            extraResources?: Array<{from?: string; to?: string}>
        }
        const configuredModel = path.normalize(path.join('config', config.modelPath))
        const packagedModels = (builder.extraResources ?? [])
            .map(resource => resource.from ? path.normalize(resource.from) : '')

        assert.ok(packagedModels.includes(configuredModel))
        assert.ok(existsSync(path.join(projectRoot, configuredModel)))
    })
})

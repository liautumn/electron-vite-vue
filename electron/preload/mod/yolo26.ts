import {contextBridge, ipcRenderer} from 'electron'
import type {
    Yolo26FrameRequest,
    Yolo26ImageRequest,
    Yolo26Methods,
} from '../../../shared/types/yolo26'

export function registerYolo26Renderer() {
    contextBridge.exposeInMainWorld('yolo26', {
        getStatus: () => ipcRenderer.invoke('yolo26:get-status'),
        inferImage: (request: Yolo26ImageRequest) => ipcRenderer.invoke('yolo26:infer-image', request),
        inferFrame: (request: Yolo26FrameRequest) => ipcRenderer.invoke('yolo26:infer-frame', request),
        stressTest: () => ipcRenderer.invoke('yolo26:stress-test'),
    } satisfies Yolo26Methods)
}

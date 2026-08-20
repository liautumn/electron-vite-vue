import {contextBridge, ipcRenderer} from 'electron'
import type {
    Yolo26FrameRequest,
    Yolo26ImageRequest,
    Yolo26Methods,
} from '../../../shared/types/yolo26'

export function registerYolo26Renderer() {
    contextBridge.exposeInMainWorld('yolo26', {
        initialize: () => ipcRenderer.invoke('yolo26:initialize'),
        dispose: () => ipcRenderer.invoke('yolo26:dispose'),
        getStatus: () => ipcRenderer.invoke('yolo26:get-status'),
        setGpuEnabled: (enabled: boolean) => ipcRenderer.invoke('yolo26:set-gpu-enabled', enabled),
        inferImage: (request: Yolo26ImageRequest) => ipcRenderer.invoke('yolo26:infer-image', request),
        inferFrame: (request: Yolo26FrameRequest) => ipcRenderer.invoke('yolo26:infer-frame', request),
        stressTest: () => ipcRenderer.invoke('yolo26:stress-test'),
    } satisfies Yolo26Methods)
}

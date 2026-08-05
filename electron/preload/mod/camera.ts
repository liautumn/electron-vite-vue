import {contextBridge, ipcRenderer} from 'electron'
import type {CameraMethods} from '../../../shared/types/camera'

export function registerCameraRenderer() {
    contextBridge.exposeInMainWorld('camera', {
        requestAccess: () => ipcRenderer.invoke('camera:request-access'),
    } satisfies CameraMethods)
}

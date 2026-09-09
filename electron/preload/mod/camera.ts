import {contextBridge, ipcRenderer} from 'electron'

export type CameraPermissionStatus =
    | 'not-determined'
    | 'granted'
    | 'denied'
    | 'restricted'
    | 'unknown'

export const cameraApi = {
    requestAccess: (): Promise<CameraPermissionStatus> => ipcRenderer.invoke('camera:request-access'),
}

export function registerCameraRenderer() {
    contextBridge.exposeInMainWorld('camera', cameraApi)
}

import {BrowserWindow, ipcMain} from 'electron'
import type {CameraPermissionStatus} from '../../../shared/types/camera'
import {requestMediaAccess} from '../utils/media-access'

let mainWindow: BrowserWindow | null = null
let registered = false

export function registerCamera(window: BrowserWindow) {
    mainWindow = window
    if (registered) return
    registered = true

    ipcMain.handle('camera:request-access', async (event): Promise<CameraPermissionStatus> => {
        if (event.sender !== mainWindow?.webContents) return 'denied'
        return requestMediaAccess('camera')
    })
}

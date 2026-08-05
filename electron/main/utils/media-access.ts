import {BrowserWindow, systemPreferences} from 'electron'

export type MediaAccessKind = 'microphone' | 'camera'

export type MediaPermissionStatus =
    | 'not-determined'
    | 'granted'
    | 'denied'
    | 'restricted'
    | 'unknown'

const requested = {
    microphone: false,
    camera: false,
}

let mainWindow: BrowserWindow | null = null

const isAllowed = (mediaType: 'audio' | 'video' | 'unknown' | undefined) => {
    if (mediaType === 'audio') return requested.microphone
    if (mediaType === 'video') return requested.camera
    return false
}

export function registerMediaAccess(window: BrowserWindow) {
    if (mainWindow?.webContents.id !== window.webContents.id) {
        requested.microphone = false
        requested.camera = false
    }
    mainWindow = window
    const applicationSession = window.webContents.session

    applicationSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
        webContents === mainWindow?.webContents
        && permission === 'media'
        && details.isMainFrame
        && isAllowed(details.mediaType)
    )
    applicationSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
        const mediaAllowed = Boolean(mediaTypes?.length && mediaTypes.every(mediaType => isAllowed(mediaType)))
        callback(
            webContents === mainWindow?.webContents
            && permission === 'media'
            && details.isMainFrame
            && mediaAllowed
        )
    })
}

export async function requestMediaAccess(kind: MediaAccessKind): Promise<MediaPermissionStatus> {
    let status: MediaPermissionStatus

    if (process.platform === 'darwin') {
        status = systemPreferences.getMediaAccessStatus(kind)
        if (status === 'not-determined') {
            const granted = await systemPreferences.askForMediaAccess(kind)
            status = granted ? 'granted' : systemPreferences.getMediaAccessStatus(kind)
            if (status === 'not-determined') status = 'denied'
        }
    } else if (process.platform === 'win32') {
        status = systemPreferences.getMediaAccessStatus(kind)
    } else {
        // Chromium owns the actual permission prompt on Linux.
        status = 'unknown'
    }

    requested[kind] = status !== 'denied' && status !== 'restricted'
    return status
}

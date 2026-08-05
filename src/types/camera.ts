export type CameraPermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'

export interface CameraMethods {
  requestAccess(): Promise<CameraPermissionStatus>
}

import { contextBridge, ipcRenderer } from 'electron'
import type {
  JsonMethods,
  JsonReadRequest,
  JsonWriteRequest,
} from '../../../shared/types/json'

export function registerJsonRenderer() {
  contextBridge.exposeInMainWorld('json', {
    read: <T = unknown>(request: JsonReadRequest<T>) =>
      ipcRenderer.invoke('json:read', request),

    write: <T = unknown>(request: JsonWriteRequest<T>) =>
      ipcRenderer.invoke('json:write', request),

    getDirectory: () => ipcRenderer.invoke('json:get-directory'),
  } as JsonMethods)
}

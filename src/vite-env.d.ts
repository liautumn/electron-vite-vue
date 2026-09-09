/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}

interface Window {
    ipcRenderer: typeof import('../electron/preload/mod/ipcRenderer').ipcRendererApi
    serial: typeof import('../electron/preload/mod/serial').serialApi
    tcp: typeof import('../electron/preload/mod/tcp').tcpApi
    mqtt: typeof import('../electron/preload/mod/mqtt').mqttApi
    sqlite: typeof import('../electron/preload/mod/sqlite').sqliteApi
    senseVoice: typeof import('../electron/preload/mod/sensevoice').senseVoiceApi
    camera: typeof import('../electron/preload/mod/camera').cameraApi
    imageFiles: typeof import('../electron/preload/mod/image-files').imageFilesApi
    yolo26: typeof import('../electron/preload/mod/yolo26').yolo26Api
}

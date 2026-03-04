/// <reference types="vite/client" />
import {SerialMethods} from "./types/serial";
import {TcpMethods} from "./types/tcp";

declare module '*.vue' {
    import type {DefineComponent} from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}


declare global {
    interface Window {
        // expose in the `electron/preload/index.ts`
        ipcRenderer: import('electron').IpcRenderer
        serial: SerialMethods
        tcp: TcpMethods
    }
}

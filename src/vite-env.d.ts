/// <reference types="vite/client" />
import {SerialMethods} from "../shared/types/serial";
import {TcpMethods} from "../shared/types/tcp";
import {MqttMethods} from "../shared/types/mqtt";
import {SqliteMethods} from "../shared/types/sqlite";

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
        mqtt: MqttMethods
        sqlite: SqliteMethods
    }
}

/// <reference types="vite/client" />
import type { SerialApi } from "../shared/types/serial";
import type { TcpApi } from "../shared/types/tcp";
import {MqttMethods} from "../shared/types/mqtt";
import {SqliteMethods} from "../shared/types/sqlite";
import {JsonMethods} from "../shared/types/json";

declare module '*.vue' {
    import type {DefineComponent} from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}


declare global {
    interface Window {
        // expose in the `electron/preload/index.ts`
        ipcRenderer: import('electron').IpcRenderer
        serial: SerialApi
        tcp: TcpApi
        mqtt: MqttMethods
        sqlite: SqliteMethods
        json: JsonMethods
    }
}

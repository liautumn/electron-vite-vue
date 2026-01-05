/// <reference types="vite/client" />

declare module '*.vue' {
    import type {DefineComponent} from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}

export interface SerialMethod {
    /** 获取串口列表 */
    list(): Promise<any[]>

    /** 打开串口 */
    open(options: { path: string; baudRate: number }): Promise<void>

    /** 关闭串口 */
    close(): Promise<void>

    /** 发送十六进制数据 */
    write(hex: string): Promise<void>

    /** 串口打开事件 */
    onOpen(cb: () => void): void

    /** 串口关闭事件 */
    onClose(cb: () => void): void

    /** 串口数据事件 */
    onData(cb: (event: Electron.IpcRendererEvent, data: string) => void): void

    /** 串口错误事件 */
    onError(cb: (event: Electron.IpcRendererEvent, msg: string) => void): void
}


interface Window {
    // expose in the `electron/preload/index.ts`
    ipcRenderer: import('electron').IpcRenderer
    serial1: SerialMethod
}

export type SerialSessionId = number

export interface SerialOpenOptions {
    sessionId?: SerialSessionId
    path: string
    baudRate: number
}

export interface SerialSessionEvent {
    sessionId: SerialSessionId
}

export interface SerialDataEvent extends SerialSessionEvent {
    data: string
}

export interface SerialErrorEvent extends SerialSessionEvent {
    message: string
}

export interface SerialMethods {
    /** 获取串口列表 */
    list(): Promise<any[]>

    /** 打开串口 */
    open(options: SerialOpenOptions): Promise<boolean>

    /** 关闭串口 */
    close(sessionId?: SerialSessionId): Promise<boolean>

    /** 发送十六进制数据 */
    write(hex: string, sessionId?: SerialSessionId): Promise<boolean>

    /** 串口打开事件 */
    onOpen(cb: (event: Electron.IpcRendererEvent, payload: SerialSessionEvent) => void): () => void

    /** 串口关闭事件 */
    onClose(cb: (event: Electron.IpcRendererEvent, payload: SerialSessionEvent) => void): () => void

    /** 串口数据事件 */
    onData(cb: (event: Electron.IpcRendererEvent, payload: SerialDataEvent) => void): () => void

    /** 串口错误事件 */
    onError(cb: (event: Electron.IpcRendererEvent, payload: SerialErrorEvent) => void): () => void
}

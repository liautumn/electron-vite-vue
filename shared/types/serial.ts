export type SerialSessionId = number

export interface SerialOpenOptions {
    path: string
    baudRate: number
}

export interface SerialOpenRequest extends SerialOpenOptions {
    sessionId?: SerialSessionId
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

export interface SerialSession {
    sessionId: SerialSessionId

    /** 关闭串口 */
    close(): Promise<boolean>

    /** 发送十六进制数据 */
    write(hex: string): Promise<boolean>

    /** 串口打开事件 */
    onOpen(cb: (payload: SerialSessionEvent) => void): () => void

    /** 串口关闭事件 */
    onClose(cb: (payload: SerialSessionEvent) => void): () => void

    /** 串口数据事件 */
    onData(cb: (payload: SerialDataEvent) => void): () => void

    /** 串口错误事件 */
    onError(cb: (payload: SerialErrorEvent) => void): () => void
}

export interface SerialApi {
    /** 获取串口列表 */
    list(): Promise<any[]>

    /** 打开串口 */
    open(options: SerialOpenRequest): Promise<boolean>

    getSessionById(sessionId: SerialSessionId): SerialSession
}

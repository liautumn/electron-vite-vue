export type TcpSessionId = number

export interface TcpConnectOptions {
    sessionId?: TcpSessionId
    host: string
    port: number
}

export interface TcpSessionEvent {
    sessionId: TcpSessionId
}

export interface TcpDataEvent extends TcpSessionEvent {
    data: string
}

export interface TcpErrorEvent extends TcpSessionEvent {
    message: string
}

export interface TcpMethods {
    /** 连接 TCP */
    connect(options: TcpConnectOptions): Promise<boolean>

    /** 断开 TCP */
    disconnect(sessionId?: TcpSessionId): Promise<boolean>

    /** 发送十六进制数据 */
    write(hex: string, sessionId?: TcpSessionId): Promise<boolean>

    /** 连接成功事件 */
    onConnect(cb: (event: Electron.IpcRendererEvent, payload: TcpSessionEvent) => void): () => void

    /** 连接关闭事件 */
    onClose(cb: (event: Electron.IpcRendererEvent, payload: TcpSessionEvent) => void): () => void

    /** TCP 数据事件 */
    onData(cb: (event: Electron.IpcRendererEvent, payload: TcpDataEvent) => void): () => void

    /** TCP 错误事件 */
    onError(cb: (event: Electron.IpcRendererEvent, payload: TcpErrorEvent) => void): () => void
}

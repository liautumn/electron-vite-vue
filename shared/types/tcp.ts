export type TcpSessionId = number

export interface TcpConnectOptions {
    host: string
    port: number
}

export interface TcpConnectRequest extends TcpConnectOptions {
    sessionId?: TcpSessionId
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

export interface TcpSession {
    sessionId: TcpSessionId

    /** 断开 TCP */
    disconnect(): Promise<boolean>

    /** 发送十六进制数据 */
    write(hex: string): Promise<boolean>

    /** 连接成功事件 */
    onConnect(cb: (payload: TcpSessionEvent) => void): () => void

    /** 连接关闭事件 */
    onClose(cb: (payload: TcpSessionEvent) => void): () => void

    /** TCP 数据事件 */
    onData(cb: (payload: TcpDataEvent) => void): () => void

    /** TCP 错误事件 */
    onError(cb: (payload: TcpErrorEvent) => void): () => void
}

export interface TcpApi {
    /** 连接 TCP */
    connect(options: TcpConnectRequest): Promise<boolean>

    getSessionById(sessionId: TcpSessionId): TcpSession
}

export interface TcpMethods {
    /** 连接 TCP */
    connect(options: { host: string; port: number }): Promise<void>

    /** 断开 TCP */
    disconnect(): Promise<void>

    /** 发送十六进制数据 */
    write(hex: string): Promise<void>

    /** 连接成功事件 */
    onConnect(cb: () => void): void

    /** 连接关闭事件 */
    onClose(cb: () => void): void

    /** TCP 数据事件 */
    onData(cb: (event: Electron.IpcRendererEvent, data: string) => void): void

    /** TCP 错误事件 */
    onError(cb: (event: Electron.IpcRendererEvent, msg: string) => void): void
}

// 从 electron 中导入 ipcRenderer（渲染进程 IPC）和 contextBridge（安全桥）
import {contextBridge, ipcRenderer} from "electron";

// ------------------------------------------------------------------
// 向 Renderer 进程暴露 API（通过 contextBridge，安全）
// ------------------------------------------------------------------
export function registerIpcRenderer() {
    contextBridge.exposeInMainWorld('ipcRenderer', {

        // 封装 ipcRenderer.on，用于监听主进程发送的消息
        on(...args: Parameters<typeof ipcRenderer.on>) {
            // 从参数中解构出 channel 和 listener
            const [channel, listener] = args
            // 调用原生 ipcRenderer.on
            // 包一层是为了后续可控（安全、拦截、日志等）
            return ipcRenderer.on(channel, (event, ...args) =>
                listener(event, ...args)
            )
        },

        // 封装 ipcRenderer.off，用于移除监听
        off(...args: Parameters<typeof ipcRenderer.off>) {
            // 解构出 channel，其余参数忽略
            const [channel, ...omit] = args
            // 调用原生 off
            return ipcRenderer.off(channel, ...omit)
        },

        // 封装 ipcRenderer.send（单向通信，无返回值）
        send(...args: Parameters<typeof ipcRenderer.send>) {
            // 第一个参数是 channel，后面是数据
            const [channel, ...omit] = args
            // 发送消息到主进程
            return ipcRenderer.send(channel, ...omit)
        },

        // 封装 ipcRenderer.invoke（推荐，Promise 风格）
        invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
            // 第一个参数是 channel，后面是参数
            const [channel, ...omit] = args
            // 调用主进程 ipcMain.handle 对应的方法
            return ipcRenderer.invoke(channel, ...omit)
        },

        // 可以在这里继续暴露你需要的其他 API
    })
}

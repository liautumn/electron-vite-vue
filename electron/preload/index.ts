// 从 electron 中导入 ipcRenderer（渲染进程 IPC）和 contextBridge（安全桥）
import {ipcRenderer, contextBridge} from 'electron'

// ------------------------------------------------------------------
// 向 Renderer 进程暴露 API（通过 contextBridge，安全）
// ------------------------------------------------------------------
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

contextBridge.exposeInMainWorld('serial', {
    list: () => ipcRenderer.invoke('serial:list'),

    open: (options: { path: string; baudRate: number }) =>
        ipcRenderer.invoke('serial:open', options),

    close: () => ipcRenderer.invoke('serial:close'),

    write: (hex: string) => ipcRenderer.invoke('serial:write', hex),

    onOpen: (cb: () => void) =>
        ipcRenderer.on('serial:open', cb),

    onClose: (cb: () => void) =>
        ipcRenderer.on('serial:close', cb),

    onData: (cb: (_: any, data: string) => void) =>
        ipcRenderer.on('serial:data', cb),

    onError: (cb: (_: any, msg: string) => void) =>
        ipcRenderer.on('serial:error', cb),
})

contextBridge.exposeInMainWorld('tcp', {
    connect: (options: { host: string; port: number }) =>
        ipcRenderer.invoke('tcp:connect', options),

    disconnect: () => ipcRenderer.invoke('tcp:disconnect'),

    write: (hex: string) => ipcRenderer.invoke('tcp:write', hex),

    onConnect: (cb: () => void) =>
        ipcRenderer.on('tcp:connect', cb),

    onClose: (cb: () => void) =>
        ipcRenderer.on('tcp:close', cb),

    onData: (cb: (_: any, data: string) => void) =>
        ipcRenderer.on('tcp:data', cb),

    onError: (cb: (_: any, msg: string) => void) =>
        ipcRenderer.on('tcp:error', cb),
})

// ------------------------------------------------------------------
// DOM Ready 工具函数
// ------------------------------------------------------------------
function domReady(
    // 默认等待 DOM 进入 interactive 或 complete
    condition: DocumentReadyState[] = ['complete', 'interactive']
) {
    return new Promise((resolve) => {

        // 如果当前状态已经满足条件
        if (condition.includes(document.readyState)) {

            // 立即 resolve
            resolve(true)

        } else {

            // 否则监听 document 状态变化
            document.addEventListener('readystatechange', () => {

                // 状态满足条件时 resolve
                if (condition.includes(document.readyState)) {
                    resolve(true)
                }
            })
        }
    })
}

// ------------------------------------------------------------------
// 安全 DOM 操作工具，避免重复插入 / 删除报错
// ------------------------------------------------------------------
const safeDOM = {

    // 安全地 append 子节点
    append(parent: HTMLElement, child: HTMLElement) {

        // 如果 parent 里还没有这个 child
        if (!Array.from(parent.children).find(e => e === child)) {

            // 才执行 append
            return parent.appendChild(child)
        }
    },

    // 安全地 remove 子节点
    remove(parent: HTMLElement, child: HTMLElement) {

        // 如果 parent 中存在这个 child
        if (Array.from(parent.children).find(e => e === child)) {

            // 才执行 remove
            return parent.removeChild(child)
        }
    },
}

// ------------------------------------------------------------------
// Loading 动画实现（应用启动过渡）
// ------------------------------------------------------------------
function useLoading() {

    // Loading 的 CSS 类名
    const className = `loaders-css__square-spin`

    // Loading 所需的 CSS 样式
    const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
  `

    // 创建 <style> 元素
    const oStyle = document.createElement('style')

    // 创建 Loading 容器 div
    const oDiv = document.createElement('div')

    // 设置 style 的 id
    oStyle.id = 'app-loading-style'

    // 写入 CSS
    oStyle.innerHTML = styleContent

    // 设置 Loading 外层 class
    oDiv.className = 'app-loading-wrap'

    // 设置 Loading 内部 HTML
    oDiv.innerHTML = `<div class="${className}"><div></div></div>`

    // 返回控制 Loading 的方法
    return {

        // 显示 Loading
        appendLoading() {

            // 把样式插入 head
            safeDOM.append(document.head, oStyle)

            // 把 Loading 插入 body
            safeDOM.append(document.body, oDiv)
        },

        // 移除 Loading
        removeLoading() {

            // 移除样式
            safeDOM.remove(document.head, oStyle)

            // 移除 Loading DOM
            safeDOM.remove(document.body, oDiv)
        },
    }
}

// ------------------------------------------------------------------
// Loading 生命周期控制
// ------------------------------------------------------------------

// 解构出显示 / 移除 Loading 的方法
const {appendLoading, removeLoading} = useLoading()

// DOM 就绪后显示 Loading
domReady().then(appendLoading)

// 监听 window.postMessage 消息
window.onmessage = (ev) => {

    // 当收到 payload === 'removeLoading' 时移除 Loading
    ev.data.payload === 'removeLoading' && removeLoading()
}

// 兜底：5 秒后强制移除 Loading，防止卡死
setTimeout(removeLoading, 4999)

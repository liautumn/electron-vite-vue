import {registerIpcRenderer} from "./mod/ipcRenderer";
import {registerTcpRenderer} from './mod/tcp'
import {registerSerialRenderer} from './mod/serial'
import {registerMqttRenderer} from './mod/mqtt'

// 注册 mod
registerIpcRenderer()
registerTcpRenderer()
registerSerialRenderer()
registerMqttRenderer()

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

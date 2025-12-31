// 从 electron 中导入核心模块
import {app, BrowserWindow, shell, ipcMain} from 'electron'

// Node.js 的 ESM 模式下，用来创建 require
import {createRequire} from 'node:module'

// 把 import.meta.url 转成文件路径
import {fileURLToPath} from 'node:url'

// Node.js 路径工具
import path from 'node:path'

// Node.js 操作系统信息
import os from 'node:os'

// 在 ESM 中手动创建 require（兼容老库）
const require = createRequire(import.meta.url)

// 在 ESM 中模拟 __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// =======================
// 打包后的目录结构说明
// =======================
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron 主进程入口
// │ └─┬ preload
// │   └── index.mjs   > Preload 脚本
// ├─┬ dist
// │ └── index.html    > 前端渲染页面
//

// 设置整个应用的根目录（回到项目根）
process.env.APP_ROOT = path.join(__dirname, '../..')

// 主进程产物目录
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')

// 前端页面目录
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

// Vite 开发服务器地址（dev 模式才有）
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// VITE_PUBLIC：
// 开发模式 -> public 目录
// 生产模式 -> dist 目录
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT, 'public')
    : RENDERER_DIST

// =======================
// Windows 7 特殊处理
// =======================

// Windows 7 的版本号是 6.1，关闭 GPU 加速防止崩溃
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Windows 10+ 设置 AppUserModelId，保证通知和任务栏正常
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

// =======================
// 单实例应用（防止多开）
// =======================

// 如果没有获取到单实例锁，说明已经有一个实例在运行
if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
}

// 主窗口引用（防止被 GC 回收）
let win: BrowserWindow | null = null

// preload 脚本路径
const preload = path.join(__dirname, '../preload/index.mjs')

// 生产环境加载的 HTML
const indexHtml = path.join(RENDERER_DIST, 'index.html')

// =======================
// 创建主窗口
// =======================
async function createWindow() {
    win = new BrowserWindow({
        // 窗口标题
        title: 'Main window',

        // 应用图标
        icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),

        // Web 相关配置
        webPreferences: {
            // 预加载脚本（安全桥）
            preload,

            // ⚠️ 以下两项在生产环境不安全，不建议开启
            // nodeIntegration: true,      // 允许 Renderer 直接用 Node
            // contextIsolation: false,    // 关闭上下文隔离
        },
    })

    // =======================
    // 加载页面（开发 / 生产）
    // =======================

    if (VITE_DEV_SERVER_URL) {
        // 开发模式：加载 Vite dev server
        win.loadURL(VITE_DEV_SERVER_URL)

        // 自动打开开发者工具
        win.webContents.openDevTools()
    } else {
        // 生产模式：加载本地 HTML
        win.loadFile(indexHtml)
    }

    // =======================
    // 主进程 → 渲染进程通信示例
    // =======================

    // 页面加载完成后，主动给 Renderer 发消息
    // win.webContents.on('did-finish-load', () => {
    //     win?.webContents.send(
    //         'main-process-message',
    //         new Date().toLocaleString()
    //     )
    // })

    // =======================
    // 外部链接用系统浏览器打开
    // =======================

    win.webContents.setWindowOpenHandler(({url}) => {
        // https 链接用默认浏览器打开
        if (url.startsWith('https:')) shell.openExternal(url)

        // 阻止 Electron 内部新开窗口
        return {action: 'deny'}
    })

    // 页面跳转拦截（未使用）
    // win.webContents.on('will-navigate', (event, url) => { })
}

// =======================
// Electron 生命周期
// =======================

// Electron 准备完成后创建窗口
app.whenReady().then(createWindow)

// 所有窗口关闭时触发
app.on('window-all-closed', () => {
    win = null

    // macOS：关闭窗口不退出应用
    if (process.platform !== 'darwin') app.quit()
})

// =======================
// 第二实例处理（配合单实例）
// =======================

app.on('second-instance', () => {
    if (win) {
        // 如果窗口最小化，先恢复
        if (win.isMinimized()) win.restore()

        // 聚焦窗口
        win.focus()
    }
})

// macOS：点击 Dock 图标重新激活
app.on('activate', () => {
    const allWindows = BrowserWindow.getAllWindows()

    if (allWindows.length) {
        allWindows[0].focus()
    } else {
        createWindow()
    }
})

// =======================
// IPC：Renderer 请求打开新窗口
// =======================

// Renderer 调用 ipcRenderer.invoke('open-win', arg)
ipcMain.handle('open-win', (_, arg) => {
    const childWindow = new BrowserWindow({
        webPreferences: {
            preload,

            // ⚠️ 示例代码，生产环境不推荐
            nodeIntegration: true,
            contextIsolation: false,
        },
    })

    // 开发模式
    if (VITE_DEV_SERVER_URL) {
        childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
    } else {
        // 生产模式，通过 hash 区分路由
        childWindow.loadFile(indexHtml, {hash: arg})
    }
})

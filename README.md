# 设备调试桌面应用

这是一个基于 `Electron`、`Vue 3`、`Vite` 和 `Quasar` 的桌面应用项目，用于验证和调试本地设备通信、协议解析、数据库读写和常见桌面端能力。

项目当前保留了示例性质的页面和接口，适合继续扩展为设备调试工具、产线工具或本地运维工具。

## 功能模块

- 设备连接管理：统一维护 `TCP` 和串口会话，上层设备按 `sessionId` 复用连接。
- `RS232/TCP` 通讯示例：验证基础收发能力。
- `MQTT` 示例：连接、订阅、取消订阅、发布和消息查看。
- `SQLite` 示例：基于 `better-sqlite3` 的本地数据增删改查。
- 国芯 `RFID` 测试：读写标签、功率配置、基带参数配置和原始帧发送。
- 锁控板测试：普通锁、电磁锁、微动开关等指令和反馈解析。
- `LED` 指示灯控制：单灯、全灯和自定义十六进制指令发送。
- 基础应用能力：路由菜单、权限过滤、主题切换、国际化、日志记录。

## 技术栈

- 桌面端：`Electron`
- 前端：`Vue 3`、`Vite`、`TypeScript`
- 界面组件：`Quasar`
- 状态管理：`Pinia`、`pinia-plugin-persistedstate`
- 本地数据库：`better-sqlite3`
- 串口通信：`serialport`
- 消息通信：`mqtt`
- 打包工具：`electron-builder`

## 运行环境

建议使用较新的 `Node.js` 和 `npm`。项目包含 `better-sqlite3`、`serialport` 这类原生模块，如果预编译包不可用，系统需要具备原生模块编译环境。

常见环境要求：

- macOS：安装 `Xcode Command Line Tools`
- Windows：安装 `Visual Studio Build Tools`
- Linux：安装 `python3`、`make`、`g++` 等编译工具

## 快速开始

```sh
npm install
npm run rebuild:native
npm run dev
```

`npm run rebuild:native` 会按当前 `Electron` 版本重新编译原生模块。项目使用了 `better-sqlite3` 和 `serialport`，建议在首次安装依赖、升级 `Electron`、切换平台或遇到原生模块加载错误后执行一次。

如果开发服务默认端口 `80` 无法启动，可以通过环境变量改端口：

```sh
VITE_DEV_PORT=5173 npm run dev
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发环境 |
| `npm run typecheck` | 执行类型检查 |
| `npm run rebuild:native` | 按 `Electron` 版本重建原生依赖 |
| `npm run build` | 构建并打包正式安装包 |
| `npm run build:test` | 使用测试模式构建并打包 |
| `npm run preview` | 预览前端构建结果 |

## 目录结构

```text
.
├── electron
│   ├── main                 主进程代码
│   │   ├── mod              主进程能力模块
│   │   └── utils            主进程工具
│   └── preload              预加载脚本，向渲染进程暴露安全接口
├── shared
│   └── types                主进程、预加载脚本和渲染进程共享类型
├── src
│   ├── api                  渲染进程接口封装
│   ├── components           通用组件和设备协议模块
│   ├── router               路由和菜单配置
│   ├── stores               Pinia 状态
│   ├── styles               全局样式
│   └── views                页面
├── public                   静态资源和应用图标
├── json                     开发环境 JSON 数据目录
├── database                 开发环境 SQLite 数据目录
├── logs                     开发环境日志目录
├── electron-builder.json5   打包配置
├── vite.config.ts           Vite 和 Electron 构建配置
└── package.json             项目脚本和依赖
```

## 架构说明

应用分为四层：

- 主进程：负责系统能力和原生能力，例如串口、`TCP`、`MQTT`、`SQLite`、文件和日志。
- 预加载脚本：通过 `contextBridge` 暴露白名单接口，渲染进程不直接访问 `Node.js`。
- 渲染进程：负责页面、状态管理、设备操作界面和协议交互。
- 共享类型：放在 `shared/types`，供主进程、预加载脚本和渲染进程复用。

当前主窗口启用了 `contextIsolation`，并关闭了渲染进程的 `nodeIntegration`。如果继续产品化，建议保持这个方向，把系统能力继续收敛在主进程。

## 数据和日志

开发环境下：

- 日志写入 `logs`
- SQLite 数据库写入 `database/app.sqlite3`
- JSON 数据写入 `json`

打包环境下：

- 日志写入应用资源目录下的 `logs`
- SQLite 和 JSON 数据写入日志目录同级的数据目录

SQLite 使用 `WAL` 模式，运行过程中可能出现 `app.sqlite3-wal` 和 `app.sqlite3-shm` 文件，这是正常现象。

## 原生依赖说明

项目依赖 `better-sqlite3` 和 `serialport`，它们都包含原生模块。原生模块必须和 `Electron` 的运行时 ABI 匹配。

如果看到类似下面的错误：

```text
was compiled against a different Node.js version
NODE_MODULE_VERSION ...
```

执行：

```sh
npm run rebuild:native
```

原因是普通 `npm install` 可能按本机 `Node.js` 编译，而应用实际运行在 `Electron` 内置的 `Node.js` 环境中。两者 ABI 不一致时，就会加载失败。

## 打包

正式打包：

```sh
npm run build
```

测试模式打包：

```sh
npm run build:test
```

打包产物输出到：

```text
release/${version}
```

当前配置支持：

- macOS：`dmg`
- Windows：`nsis`
- Linux：`AppImage`

因为项目包含原生依赖，打包前建议先执行：

```sh
npm run rebuild:native
```

## 常见问题

### 启动时报原生模块版本不匹配

执行：

```sh
npm run rebuild:native
```

如果仍然失败，可以删除 `node_modules` 后重新安装依赖，再执行重建命令。

### 开发服务端口启动失败

项目默认从环境变量读取开发服务端口，没有配置时使用 `80`。如果端口被占用或系统不允许普通用户监听 `80` 端口，可以改用高位端口：

```sh
VITE_DEV_PORT=5173 npm run dev
```

### 串口列表为空

先确认系统能识别设备，再检查权限、驱动和连接线。部分系统需要给当前用户串口访问权限。

### SQLite 目录下出现额外文件

`app.sqlite3-wal` 和 `app.sqlite3-shm` 是 `WAL` 模式产生的辅助文件，应用运行时出现是正常的。

## 开发注意事项

- 渲染进程不要直接引入 `Node.js` 模块，需要通过预加载脚本暴露接口。
- 新增系统能力时，优先放到 `electron/main/mod` 和 `electron/preload/mod`。
- 新增跨进程类型时，优先放到 `shared/types`。
- 当前 `sqlite.execute` 属于示例级通用接口。如果要做正式业务，建议改成主进程领域接口，避免渲染进程传任意 SQL。
- 当前应用在主进程里配置了远程调试端口。发布正式版本前，建议只在开发环境开启。

## 来源

项目基于 `electron-vite-vue` 模板继续扩展。

# Electron 构建镜像

| Dockerfile | 基础镜像 | 生成的镜像 |
| --- | --- | --- |
| `Dockerfile.linux` | `electronuserland/builder:latest` | `electron-builder:node24-linux-amd64` |
| `Dockerfile.win` | `electronuserland/builder:wine` | `electron-builder:node24-win-amd64` |

两个镜像均内置 Node.js 24、Node 自带的 npm、pnpm 10 和 Yarn Classic 1.22.22。
Windows 构建镜像还保留了上游的 Wine 环境。默认工作目录为 `/project`。

## IDEA 运行配置

项目的 `.run` 目录已提供以下 npm 运行配置，在 IDEA 的运行配置下拉框中选择即可：

| 运行配置 / npm 脚本 | 用途 |
| --- | --- |
| `docker:images` | 构建并加载两个 Docker 镜像 |
| `docker:install:linux` | 在 Linux 构建镜像内安装依赖 |
| `docker:install:win` | 在 Windows 构建镜像内安装依赖 |
| `docker:build:linux` | 打包 Linux x64 安装包 |
| `docker:build:win` | 打包 Windows x64 安装包 |

首次使用先运行 `docker:images`，然后运行目标系统的 `docker:install:*`，最后运行
对应的 `docker:build:*`。依赖变化或依赖卷被删除后，需要重新运行对应的安装配置。
打包配置会使用 electron-builder 默认的原生依赖重建流程。

手动创建 npm 运行配置时，按以下方式填写：

- `package.json`：当前项目的 `package.json`。
- 命令：`run`。
- 脚本：选择上表中的脚本，例如 `docker:build:win`。
- Node 运行时：本机 Node，例如当前项目使用的本机 Node 24。
- 软件包管理器：本机 npm。

本机 npm 负责启动 Docker，项目依赖安装和打包在容器内执行。这里的 Node 运行时
保持为本机解释器即可。需要提前启动 Docker / OrbStack，并确保本机可以执行 `docker`。
如果 IDEA 尚未显示新增配置，关闭运行配置窗口后重新打开，必要时重新打开项目。

也可以在终端执行同名脚本，例如：

```sh
npm run docker:install:linux
npm run docker:build:linux
```

安装和打包会共用对应的 `electron-builder-linux-amd64-node-modules` 或
`electron-builder-win-amd64-node-modules` 命名卷。卷不存在时自动创建，创建时不会
复制宿主机的 `node_modules`；源码和 `release` 打包产物仍在本地项目中。

## 构建镜像

在项目根目录执行以下命令，使用 Docker Buildx 一次构建两个镜像并加载到本地：

```sh
docker buildx bake -f docker-build/docker-bake.hcl --pull --load
```

也可以分别构建：

```sh
docker buildx build --platform linux/amd64 --pull --load \
  -f docker-build/Dockerfile.linux \
  -t electron-builder:node24-linux-amd64 docker-build

docker buildx build --platform linux/amd64 --pull --load \
  -f docker-build/Dockerfile.win \
  -t electron-builder:node24-win-amd64 docker-build
```

可通过 `--build-arg` 指定以下版本：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_VERSION` | `24` | 必须为 Node 24 系列，可指定具体的 24.x 版本 |
| `PNPM_VERSION` | `10` | pnpm 版本 |
| `YARN_VERSION` | `1.22.22` | Yarn 版本 |

默认配置使用 Node 24 和 pnpm 10 的大版本标签，没有固定补丁版本。
需要刷新包管理器版本时，可在构建命令中加上 `--no-cache`，避免复用安装缓存。
如果需要可复现的构建，应固定具体版本，并在 Dockerfile 中固定基础镜像的 digest。

## 系统与 CPU 架构

这两个上游镜像目前仅提供 `linux/amd64` 架构。镜像标签中：

- `linux` / `win` 表示 Electron 的打包目标系统。
- `amd64` 表示容器的 CPU 架构，对应 Node/Electron 中的 `x64`。
- `node24` 表示内置的 Node 主版本。

两者实际都是 Linux 容器，`win` 镜像通过 Wine 构建 Windows 安装包。

在 Apple Silicon 等 ARM64 主机上，仍需指定 `--platform linux/amd64`，并启用 Docker
的 x86 模拟能力。以上基础镜像无法构建原生 ARM64 容器；仅将标签改为 `arm64`
不会改变实际架构。原生 ARM64 镜像需要另外选择支持 ARM64 的基础镜像。

镜像标签不会自动设置 Electron 安装包的架构，需要向 electron-builder 传入
`--x64` 或 `--arm64`。原生依赖的跨平台编译仍需要相应的目标二进制或编译环境。
本项目包含原生模块，若没有可用的 Windows 预编译二进制，可能仍需要原生 Windows
构建环境。

## 验证环境

```sh
docker run --rm --platform linux/amd64 electron-builder:node24-linux-amd64 \
  bash -c 'node --version && npm --version && pnpm --version && yarn --version && node -p process.arch'

docker run --rm --platform linux/amd64 electron-builder:node24-win-amd64 \
  bash -c 'node --version && npm --version && pnpm --version && yarn --version && node -p process.arch && wine --version'
```

## 打包当前项目

在项目根目录执行。以下命令为两个目标分别使用独立的依赖卷，避免容器依赖与宿主机
或另一个目标的 `node_modules` 混用。

```sh
docker run --rm --platform linux/amd64 \
  -v "$PWD:/project" \
  -v electron-builder-linux-amd64-node-modules:/project/node_modules \
  electron-builder:node24-linux-amd64 \
  bash -c 'npm install && npm run build:linux -- --x64'

docker run --rm --platform linux/amd64 \
  -v "$PWD:/project" \
  -v electron-builder-win-amd64-node-modules:/project/node_modules \
  electron-builder:node24-win-amd64 \
  bash -c 'npm install && npm run build:win -- --x64'
```

打包产物按目标系统、CPU 架构和版本写入本地项目目录：

```text
release/linux-x64-release/1.0.0/
release/win-x64-release/1.0.0/
```

目录模板为 `release/${os}-${arch}-release/${version}`。其中 `x64` 是 electron-builder
对 `amd64` 的命名，系统名取打包目标，因此 Wine 容器打包 Windows 时使用 `win`。
镜像本身仅包含构建工具，不包含本项目的源码和依赖。

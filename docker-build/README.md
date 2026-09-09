# Electron Linux 构建镜像

| Dockerfile | 基础镜像 | 生成的镜像 |
| --- | --- | --- |
| `Dockerfile.linux` | `electronuserland/builder:latest` | `electron-builder:node24-linux-amd64` |

镜像内置 Node.js 24、Node 自带的 npm、pnpm 10 和 Yarn Classic 1.22.22。
默认工作目录为 `/project`。

## 构建镜像

需要提前启动 Docker / OrbStack，并确保本机可以执行 `docker`。
在项目根目录执行以下命令，构建本地 Linux 镜像：

```sh
docker build --platform linux/amd64 --pull \
  -f docker-build/Dockerfile.linux \
  -t electron-builder:node24-linux-amd64 docker-build
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

上游镜像目前仅提供 `linux/amd64` 架构。镜像标签中：

- `linux` 表示 Electron 的打包目标系统。
- `amd64` 表示容器的 CPU 架构，对应 Node/Electron 中的 `x64`。
- `node24` 表示内置的 Node 主版本。

在 Apple Silicon 等 ARM64 主机上，仍需指定 `--platform linux/amd64`，并启用 Docker
的 x86 模拟能力。以上基础镜像无法构建原生 ARM64 容器；仅将标签改为 `arm64`
不会改变实际架构。原生 ARM64 镜像需要另外选择支持 ARM64 的基础镜像。

镜像标签不会自动设置 Electron 安装包的架构，需要向 electron-builder 传入
`--x64` 来构建 Linux x64 安装包。仅改为 `--arm64` 不能保证原生依赖跨架构编译成功。

## 验证环境

```sh
docker run --rm --platform linux/amd64 electron-builder:node24-linux-amd64 \
  bash -c 'node --version && npm --version && pnpm --version && yarn --version && node -p process.arch'
```

## 打包当前项目

在项目根目录执行。以下命令使用独立的依赖卷，避免容器依赖与宿主机
或另一个目标的 `node_modules` 混用。

命名卷不存在时会自动创建，`nocopy` 防止复制宿主机的 `node_modules`。
源码和 `release` 打包产物仍在本地项目中。

Linux 使用 electron-builder 默认的原生依赖重建流程。

```sh
docker run --rm --platform linux/amd64 \
  -v "$PWD:/project" \
  -v electron-builder-linux-amd64-node-modules:/project/node_modules:nocopy \
  electron-builder:node24-linux-amd64 \
  bash -c 'npm install && npm run build -- --linux --x64'
```

打包产物按目标系统、CPU 架构和版本写入本地项目目录：

```text
release/linux-x64-release/1.0.0/
```

目录模板为 `release/${os}-${arch}-release/${version}`。其中 `x64` 是 electron-builder
对 `amd64` 的命名，Linux 打包时系统名为 `linux`。
镜像本身仅包含构建工具，不包含本项目的源码和依赖。

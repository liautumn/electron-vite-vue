import path from 'node:path'

type PortablePathOptions = {
    configDirectory: string
    userDataDirectory: string
}

const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i

const resolveUserDataUrl = (configuredPath: string, userDataDirectory: string) => {
    const url = new URL(configuredPath)
    if (url.protocol !== 'userdata:') {
        throw new Error(`不支持的路径协议：${url.protocol}`)
    }
    if (url.username || url.password || url.port || url.search || url.hash) {
        throw new Error('userData 路径不能包含认证信息、端口、查询参数或片段')
    }

    const segments = [url.hostname, ...url.pathname.split('/')]
        .filter(Boolean)
        .map(segment => decodeURIComponent(segment))
    if (!segments.length) throw new Error('userData 路径不能为空')

    const root = path.resolve(userDataDirectory)
    const resolvedPath = path.resolve(root, ...segments)
    const relativePath = path.relative(root, resolvedPath)
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error('userData 路径不能指向用户数据目录之外')
    }
    return resolvedPath
}

export const resolvePortablePath = (value: unknown, options: PortablePathOptions) => {
    if (typeof value !== 'string' || !value.trim()) return ''
    const configuredPath = value.trim()

    if (path.isAbsolute(configuredPath)) return path.normalize(configuredPath)
    if (URI_SCHEME.test(configuredPath)) {
        return resolveUserDataUrl(configuredPath, options.userDataDirectory)
    }
    return path.resolve(options.configDirectory, configuredPath)
}

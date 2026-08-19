import {app} from 'electron'
import {readFileSync} from 'node:fs'
import path from 'node:path'

export type ModelConfigSection = 'sensevoice' | 'yolo26'

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

export const getModelConfigPath = (legacyEnvironmentVariable: string) => {
    const configuredPath = process.env.MODELS_CONFIG_PATH?.trim()
        || process.env[legacyEnvironmentVariable]?.trim()
    if (configuredPath) return path.resolve(configuredPath)

    return path.join(
        app.isPackaged ? process.resourcesPath : process.env.APP_ROOT ?? process.cwd(),
        'config',
        'models.json'
    )
}

export const readModelConfigSection = <T>(
    configPath: string,
    section: ModelConfigSection
): T => {
    const root = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    if (!isRecord(root)) throw new Error('模型配置根节点必须是对象')

    // A flat object keeps legacy per-engine configuration files working.
    const hasNamedSections = 'sensevoice' in root || 'yolo26' in root
    const value = hasNamedSections ? root[section] : root
    if (value === undefined) throw new Error(`模型配置缺少 ${section} 区块`)
    if (!isRecord(value)) throw new Error(`${section} 配置必须是对象`)
    return value as T
}

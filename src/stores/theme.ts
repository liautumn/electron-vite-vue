import {defineStore} from 'pinia'
import {computed, onScopeDispose, ref, watch} from 'vue'

// 主题偏好类型：表示用户选择的主题模式
// light   ：强制浅色主题
// dark    ：强制深色主题
// system  ：跟随系统主题
export type ThemePreference = 'light' | 'dark' | 'system'
// 最终生效的主题类型
// 不包含 system，因为 system 会被解析为 light 或 dark
export type ResolvedTheme = 'light' | 'dark'
// 获取当前系统主题（light / dark）
const getSystemTheme = (): ResolvedTheme => {
    // 在 SSR / Node 环境下没有 window 或 matchMedia
    // 为避免报错，默认返回 light
    if (typeof window === 'undefined' || !window.matchMedia) return 'light'
    // 使用 matchMedia 判断系统是否启用深色模式
    // true  -> dark
    // false -> light
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 将主题应用到页面上
const applyTheme = (theme: ResolvedTheme) => {
    // SSR 环境下 document 不存在，直接返回
    if (typeof document === 'undefined') return
    // 给 <html> 根节点设置 data-theme 属性
    // 例如：<html data-theme="dark">
    // 方便 CSS / Tailwind / Ant Design 根据主题做样式切换
    document.documentElement.dataset.theme = theme
}

// 定义主题 Store
export const useThemeStore = defineStore(
    // Store 的唯一 ID
    'theme',
    // 使用 setup 语法定义 Store
    () => {
        // 用户选择的主题偏好
        // 默认值为 system（跟随系统）
        const preference = ref<ThemePreference>('system')
        // 当前系统主题（light / dark）
        // 初始化时立即获取一次
        const systemTheme = ref<ResolvedTheme>(getSystemTheme())
        // 计算最终生效的主题
        // 如果用户选择 system，则使用 systemTheme
        // 否则直接使用用户选择的主题
        const resolvedTheme = computed<ResolvedTheme>(() =>
            preference.value === 'system'
                ? systemTheme.value
                : preference.value
        )
        // 用于保存 matchMedia 返回的 MediaQueryList 实例
        // 方便在销毁时移除事件监听
        let mediaQuery: MediaQueryList | null = null
        // 系统主题发生变化时的回调函数
        const handleSystemChange = (event: MediaQueryListEvent) => {
            // event.matches 为 true 表示系统切换到了深色模式
            // false 表示切换到了浅色模式
            systemTheme.value = event.matches ? 'dark' : 'light'
        }
        // 监听系统主题变化
        // 让 system 偏好可以实时响应操作系统主题切换
        const watchSystemTheme = () => {
            // SSR / 低版本浏览器保护
            if (typeof window === 'undefined' || !window.matchMedia) return
            // 创建一个媒体查询对象，用于监听系统主题
            mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
            // 初始化 systemTheme，确保与当前系统主题一致
            systemTheme.value = mediaQuery.matches ? 'dark' : 'light'
            // 注册系统主题变化监听事件
            mediaQuery.addEventListener('change', handleSystemChange)
            // 当当前作用域销毁时，移除事件监听
            // 防止内存泄漏
            onScopeDispose(() =>
                mediaQuery?.removeEventListener('change', handleSystemChange)
            )
        }
        // 设置用户主题偏好
        const setPreference = (next: ThemePreference) => {
            // 更新用户选择的主题偏好
            preference.value = next
        }
        // 监听最终生效的主题
        // 一旦发生变化，立即应用到页面
        // immediate: true 表示初始化时立即执行一次
        watch(
            resolvedTheme,
            theme => applyTheme(theme),
            {immediate: true}
        )
        // 启动系统主题监听
        watchSystemTheme()
        // 向外暴露 Store 的状态和方法
        return {
            // 当前主题偏好（light / dark / system）
            preference,
            // 当前实际生效的主题（light / dark）
            resolvedTheme,
            // 修改主题偏好的方法
            setPreference
        }
    },
    // Pinia 持久化配置
    {
        persist: {
            // localStorage 中使用的 key
            key: 'theme-store',
            // 使用 localStorage 进行持久化
            storage: localStorage
        }
    }
)

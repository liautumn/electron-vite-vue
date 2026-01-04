import {defineStore} from 'pinia'
import {computed, onScopeDispose, ref, watch} from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const getSystemTheme = (): ResolvedTheme => {
    if (typeof window === 'undefined' || !window.matchMedia) return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const applyTheme = (theme: ResolvedTheme) => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = theme
}

export const useThemeStore = defineStore(
    'theme',
    () => {
        const preference = ref<ThemePreference>('system')
        const systemTheme = ref<ResolvedTheme>(getSystemTheme())
        const resolvedTheme = computed<ResolvedTheme>(() =>
            preference.value === 'system' ? systemTheme.value : preference.value
        )

        let mediaQuery: MediaQueryList | null = null
        const handleSystemChange = (event: MediaQueryListEvent) => {
            systemTheme.value = event.matches ? 'dark' : 'light'
        }

        // Keep system theme in sync so "system" preference reacts to OS changes
        const watchSystemTheme = () => {
            if (typeof window === 'undefined' || !window.matchMedia) return
            mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
            systemTheme.value = mediaQuery.matches ? 'dark' : 'light'
            mediaQuery.addEventListener('change', handleSystemChange)
            onScopeDispose(() => mediaQuery?.removeEventListener('change', handleSystemChange))
        }

        const setPreference = (next: ThemePreference) => {
            preference.value = next
        }

        watch(resolvedTheme, theme => applyTheme(theme), {immediate: true})
        watchSystemTheme()

        return {
            preference,
            resolvedTheme,
            setPreference
        }
    },
    {
        persist: {
            key: 'theme-store',
            storage: localStorage
        }
    }
)

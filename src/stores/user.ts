import {defineStore} from 'pinia'
import {ref, computed} from 'vue'

const DEFAULT_PERMISSIONS = [
    // 默认授予基础页面的权限，可根据业务登录后覆盖
    'app:home:view',
    'app:demos:view',
    'app:demos:pinia',
    'app:demos:serialport',
    'app:demos:serialport:refresh',
    'app:demos:command-example',
    'app:demos:rs232-tcp',
    'app:demos:mqtt',
    'app:demos:sqlite',
    'app:demos:guoxin-rfid',
    'app:demos:pad-lock',
] as const

const mergeDefaultPermissions = (list: string[] | undefined) => {
    if (!Array.isArray(list) || list.length === 0) return [...DEFAULT_PERMISSIONS]
    return Array.from(new Set([...list, ...DEFAULT_PERMISSIONS]))
}

export const useUserStore = defineStore(
    'user',
    () => {
        const name = ref<string>('')
        const token = ref<string>('')
        const permissions = ref<string[]>([...DEFAULT_PERMISSIONS])

        const getName = computed(() => name.value)
        const getToken = computed(() => token.value)
        const getPermissions = computed(() => permissions.value)

        function setName(newName: string) {
            name.value = newName
        }

        function setToken(newToken: string) {
            token.value = newToken
        }

        function setPermissions(list: string[]) {
            permissions.value = list
        }

        function refreshPermissions() {
            permissions.value = mergeDefaultPermissions(permissions.value)
        }

        function hasPermission(code: string) {
            // Demo 约定：若权限列表为空视为全量可用，便于首次加载和无权限数据时正常展示
            if (permissions.value.length === 0) return true
            return permissions.value.includes(code)
        }

        function clearUser() {
            name.value = ''
            token.value = ''
            permissions.value = []
        }

        return {
            name,
            token,
            permissions,
            getName,
            getToken,
            getPermissions,
            setName,
            setToken,
            setPermissions,
            refreshPermissions,
            hasPermission,
            clearUser,
        }
    },
    {
        // pinia-plugin-persist(-edstate) 配置
        persist: {
            key: 'user-store',
            storage: localStorage,
            afterHydrate: (context) => {
                const store = context.store as typeof context.store & {
                    permissions: string[]
                }
                store.permissions = mergeDefaultPermissions(store.permissions)
                store.$persist()
            },
        },
    }
)

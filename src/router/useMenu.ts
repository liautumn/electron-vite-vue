import {computed} from 'vue' // 计算属性
import {useRoute, useRouter} from 'vue-router' // 路由实例与当前路由
import {useUserStore} from '../stores/user' // 权限数据
import {routes} from './routes' // 静态路由表

type UiMenuItem = {
    key: string
    label: string
    disabled?: boolean
    children?: UiMenuItem[]
}

type MenuRoute = {
    name?: string | symbol
    redirect?: unknown
    meta?: {
        title?: string
        visible?: boolean
        enabled?: boolean
        permission?: string
        permissions?: string[]
        type?: 'directory' | 'menu' | 'button'
    }
    children?: MenuRoute[]
}

const hasAccess = (meta: MenuRoute['meta'], userStore: ReturnType<typeof useUserStore>) => {
    const codes = [
        ...(meta?.permission ? [meta.permission] : []),
        ...(meta?.permissions ?? []),
    ]
    return codes.every(code => userStore.hasPermission(code))
}

const toMenuItems = (routeRecords: MenuRoute[], userStore: ReturnType<typeof useUserStore>): UiMenuItem[] =>
    routeRecords.flatMap(route => {
        const meta = route.meta
        if (!route.name || meta?.visible === false || meta?.type === 'button' || !hasAccess(meta, userStore)) {
            return []
        }

        const children = route.children ? toMenuItems(route.children, userStore) : []
        if (meta?.type === 'directory' && children.length === 0) return []
        if (route.redirect) return []

        return [{
            key: String(route.name),
            label: meta?.title ?? String(route.name),
            disabled: meta?.enabled === false,
            ...(children.length ? {children} : {}),
        }]
    })

export const useMenu = () => {
    const router = useRouter() // 路由实例
    const route = useRoute() // 当前路由
    const userStore = useUserStore() // 权限 store

    const items = computed(() => toMenuItems(routes as MenuRoute[], userStore))

    const selectedKey = computed(() => String(route.name ?? ''))
    const activeRootKey = computed(() => String(route.matched[0]?.name ?? route.name ?? ''))

    const navigate = (item: UiMenuItem) => {
        if (item.disabled) return
        void router.push({name: item.key})
    }

    return {items, selectedKey, activeRootKey, navigate} // 暴露菜单数据
}

import {computed, h} from 'vue' // 计算属性与 VNode 工具
import {useRoute, useRouter} from 'vue-router' // 路由实例与当前路由
import {MenuProps} from 'ant-design-vue' // AntD 菜单类型
import {AppstoreOutlined} from '@ant-design/icons-vue' // 菜单默认图标
import {useUserStore} from '../stores/user' // 权限数据
import routesConfig from './routes.json' // JSON 路由表

// JSON 路由类型（仅保留菜单/权限相关字段）
type NavRoute = {
    path: string // 路径
    name?: string // 路由名
    redirect?: string // 重定向
    alias?: string | string[] // 别名
    meta?: {
        title?: string // 菜单标题
        layout?: string // 布局标记
        visible?: boolean // 是否显示
        enabled?: boolean // 是否可用
        permission?: string // 单个权限码
        permissions?: string[] // 多个权限码
        type?: 'directory' | 'menu' | 'button' // 节点类型
    }
    children?: NavRoute[] // 子路由
}

const joinPath = (parent: string, child: string) => `${parent}/${child}`.replace(/\/+/g, '/') // 拼接路径

// 权限检查：无配置即通过
const hasAccess = (meta: NavRoute['meta'], userStore: ReturnType<typeof useUserStore>) => {
    const codes = [
        ...(typeof meta?.permission === 'string' ? [meta.permission] : []), // 单权限
        ...(Array.isArray(meta?.permissions)
            ? meta.permissions.filter((code): code is string => typeof code === 'string') // 多权限
            : []),
    ]
    if (!codes.length) return true // 未要求权限
    return codes.every(code => userStore.hasPermission(code)) // 全满足才通过
}

// 递归生成菜单数据，过滤按钮/隐藏/无权限节点
const toMenuItems = (
    routes: NavRoute[], // 当前层路由
    parentPath: string, // 父路径
    userStore: ReturnType<typeof useUserStore>, // 权限来源
    router: ReturnType<typeof useRouter> // 路由实例
): MenuProps['items'] =>
    routes
        .map(route => {
            const type = route.meta?.type ?? 'menu' // 默认菜单
            const fullPath = route.path.startsWith('/') ? route.path : joinPath(parentPath, route.path) // 绝对路径
            const aliasPath = Array.isArray(route.alias)
                ? route.alias.find(p => typeof p === 'string' && p.startsWith('/')) // 取第一个绝对别名
                : (typeof route.alias === 'string' && route.alias.startsWith('/') ? route.alias : undefined)
            const navTarget = aliasPath || fullPath // 实际导航地址
            const visible =
                route.meta?.layout !== 'blank' && // 非空白布局
                route.meta?.visible !== false && // 未隐藏
                hasAccess(route.meta, userStore) // 权限通过

            let children = route.children?.length ? toMenuItems(route.children, fullPath, userStore, router) : undefined // 子菜单
            if (children && children.length === 0) children = undefined // 空子菜单不展示

            if (type === 'directory') {
                if (!visible || !children) return null // 目录需可见且有子菜单
                return {
                    key: fullPath, // 目录 key
                    icon: () => h(AppstoreOutlined), // 目录图标
                    label: route.meta?.title ?? route.name, // 展示名
                    title: route.meta?.title ?? route.name, // 提示
                    children, // 子节点
                }
            }

            const isButton = type === 'button' // 按钮类型不入菜单
            const show =
                visible && // 可见
                !isButton && // 非按钮
                !route.redirect && // 非重定向
                !navTarget.includes(':') // 非动态路由

            if (!show) return null
            return {
                key: fullPath, // 菜单 key
                icon: () => h(AppstoreOutlined), // 菜单图标
                label: route.meta?.title ?? route.name, // 展示名
                title: route.meta?.title ?? route.name, // 提示
                disabled: route.meta?.enabled === false || !hasAccess(route.meta, userStore), // 禁用判定
                onClick: () => router.push(navTarget), // 点击跳转
                children, // 子菜单
            }
        })
        .filter(Boolean) as NonNullable<MenuProps['items']> // 剔除 null

export const useMenu = () => {
    const router = useRouter() // 路由实例
    const route = useRoute() // 当前路由
    const userStore = useUserStore() // 权限 store

    const items = computed<MenuProps['items']>(() => toMenuItems(routesConfig as NavRoute[], '', userStore, router)) // 动态菜单

    const selectedKeys = computed<string[]>({
        get: () => [route.matched.at(-1)?.path ?? route.path], // 当前激活路径
        set: () => {}, // 占位以兼容 v-model
    })

    return {items, selectedKeys} // 暴露菜单数据
}

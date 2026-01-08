import {
    createRouter,            // 创建路由实例
    createWebHashHistory,    // 使用 hash 模式（兼容 file://）
    RouterView,              // 占位组件，用于目录节点
    type RouteComponent,     // 组件类型
    type RouteMeta,          // meta 类型
    type RouteRecordRaw      // 路由记录类型
} from 'vue-router'
import {unref} from 'vue' // 从 ref 中取值，避免 .value
import routesConfig from './routes.json' // 纯 JSON 路由表，菜单/权限可复用
import {useUserStore} from '../stores/user' // 权限与登录态来源

type RouteComponentLoader = () => Promise<RouteComponent> // 异步组件加载器类型

// 扫描 views 目录下的所有页面组件（按需加载，键为相对路径）
const viewModules = import.meta.glob('../views/**/*.vue') as Record<
    string,
    () => Promise<{ default: RouteComponent }>
>

// JSON 路由声明（component 写 views 下相对路径，如 demo/index）
type JsonRoute = {
    path: string               // 路由路径
    name: string               // 路由名称
    component: string          // 组件路径（相对 views）
    redirect?: string          // 重定向目标
    alias?: string | string[]  // 别名
    props?: boolean            // 是否将 params 作为 props
    meta?: RouteMeta & {
        title?: string         // 页面标题
        icon?: string          // 菜单图标标识
        requiresAuth?: boolean // 是否需要登录
        keepAlive?: boolean    // 是否缓存
        layout?: string        // 布局标记
        visible?: boolean      // 是否显示在菜单
        enabled?: boolean      // 是否可用
        permission?: string    // 单权限
        permissions?: string[] // 多权限
        type?: 'directory' | 'menu' | 'button' // 节点类型
    }
    children?: JsonRoute[]     // 子路由
}

// 未匹配组件时的兜底（404）
const fallbackComponent: RouteComponentLoader = () => import('../views/NotFoundView.vue').then(m => m.default)

// 将 JSON 配置转换为 RouteRecordRaw
const normalizeRoutes = (config: JsonRoute[]): RouteRecordRaw[] =>
    config.map<RouteRecordRaw>(route => {
        const record = {
            path: route.path,                       // 必填：路径
            name: route.name,                       // 必填：名称
            component: resolveComponent(route.component), // 解析成异步组件
            ...(route.alias ? {alias: route.alias} : {}), // 可选别名
            ...(route.props !== undefined ? {props: route.props} : {}), // 透传 params
            ...(route.meta ? {meta: route.meta} : {}),   // meta 信息
            ...(route.redirect ? {redirect: route.redirect} : {}), // 重定向
        } as RouteRecordRaw

        if (route.children?.length) { // 递归处理子路由
            (record as RouteRecordRaw & { children: RouteRecordRaw[] }).children = normalizeRoutes(route.children)
        }

        return record
    })

// 解析 JSON 中的 component 字段 -> 真实组件
const resolveComponent = (name: string): RouteComponentLoader => {
    if (name === 'RouterView') { // 特殊关键字：渲染占位 router-view
        return () => Promise.resolve(RouterView as RouteComponent)
    }

    const normalizedPath = normalizeComponentPath(name) // 标准化路径
    const loader = viewModules[normalizedPath] // 匹配 import.meta.glob 结果
    if (loader) return () => loader().then(mod => mod.default) // 懒加载组件

    // 未匹配到时警告并使用 404
    console.warn(`[router] Unknown component "${name}" in routes.json, falling back to NotFoundView.`)
    return fallbackComponent
}

// demo/index -> ../views/demo/index.vue
const normalizeComponentPath = (name: string): string => {
    const cleaned = name.replace(/^\.?\/*/, '') // 去掉开头的 ./ 或 /
    const filename = cleaned.endsWith('.vue') ? cleaned : `${cleaned}.vue` // 补全 .vue
    return `../views/${filename}`
}

const router = createRouter({
    history: createWebHashHistory(), // 哈希路由，适配 file:// 或本地
    routes: normalizeRoutes(routesConfig as JsonRoute[]), // 动态路由表
    scrollBehavior(_to, _from, savedPosition) { // 滚动行为
        if (savedPosition) return savedPosition // 浏览器返回时保持位置
        return {left: 0, top: 0} // 默认回顶部
    },
})

const baseTitle = 'electron-vite-vue' // 标题前缀

router.beforeEach((to, _from, next) => {
    document.title = to.meta?.title ? `${to.meta.title} | ${baseTitle}` : baseTitle // 设置标题

    const userStore = useUserStore() // 读取登录/权限
    const requiresAuth = to.meta?.requiresAuth // 是否需要登录
    const requiredPermissions = [ // 收集权限要求
        ...(typeof to.meta?.permission === 'string' ? [to.meta.permission] : []),
        ...(Array.isArray(to.meta?.permissions)
            ? to.meta.permissions.filter((code): code is string => typeof code === 'string')
            : []),
    ]
    const token = unref(userStore.token) // 当前 token

    if (requiresAuth && !token) { // 需要登录但无 token
        next({name: 'home'})
        return
    }

    if (requiredPermissions.length) { // 权限校验
        const allowed = requiredPermissions.every(code => userStore.hasPermission(code))
        if (!allowed) {
            console.warn(`[router] no permission for route ${to.fullPath}`)
            next({name: 'home'})
            return
        }
    }

    next()
})

export default router

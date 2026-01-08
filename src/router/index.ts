// 从 vue-router 导入路由创建方法和类型
import {
    createRouter,
    createWebHashHistory,
    type RouteComponent,
    type RouteMeta,
    type RouteRecordRaw
} from 'vue-router'
// 读取 JSON 配置的路由表
import routesConfig from './routes.json'

// 异步组件加载器类型
type RouteComponentLoader = () => Promise<RouteComponent>

// 通过 import.meta.glob 动态收集 views 目录下的所有页面组件
const viewModules = import.meta.glob('../views/**/*.vue') as Record<
    string,
    () => Promise<{ default: RouteComponent }>
>

// JSON 路由声明格式
type JsonRoute = {
    path: string
    name: string
    component: string
    redirect?: string
    alias?: string | string[]
    props?: boolean
    meta?: RouteMeta & {
        title?: string
        icon?: string
        requiresAuth?: boolean
        keepAlive?: boolean
        layout?: string
        visible?: boolean
        enabled?: boolean
    }
    children?: JsonRoute[]
}

// 未匹配到组件时的兜底页面
const fallbackComponent: RouteComponentLoader = () => import('../views/NotFoundView.vue').then(m => m.default)

// 将 JSON 路由配置转换为 vue-router 可识别的 RouteRecordRaw
const normalizeRoutes = (config: JsonRoute[]): RouteRecordRaw[] =>
    config.map<RouteRecordRaw>(route => {
        // redirect 类型：只保留跳转信息
        if (route.redirect) {
            return {
                path: route.path,
                name: route.name,
                redirect: route.redirect,
            } as RouteRecordRaw
        }

        // 基础路由信息
        const record = {
            path: route.path,
            name: route.name,
            component: resolveComponent(route.component),
            ...(route.alias ? {alias: route.alias} : {}),
            ...(route.props !== undefined ? {props: route.props} : {}),
            ...(route.meta ? {meta: route.meta} : {}),
        } as RouteRecordRaw

        // 嵌套路由处理
        if (route.children?.length) {
            (record as RouteRecordRaw & { children: RouteRecordRaw[] }).children = normalizeRoutes(route.children)
        }

        return record
    })

// 根据 JSON 中的 component 名称解析到具体的页面组件
const resolveComponent = (name: string): RouteComponentLoader => {
    const normalized = normalizeComponentPath(name)
    const loader = viewModules[normalized]
    if (loader) return () => loader().then(mod => mod.default)

    // 未找到时回退到 404 页面并输出警告
    console.warn(`[router] Unknown component "${name}" in routes.json, falling back to NotFoundView.`)
    return fallbackComponent
}

// 兼容多种写法的组件路径：HomeView / HomeView.vue / /HomeView.vue / ../views/HomeView.vue
const normalizeComponentPath = (name: string): string => {
    const filename = name.endsWith('.vue') ? name : `${name}.vue`
    if (filename.startsWith('../views/')) return filename
    if (filename.startsWith('/')) return `../views/${filename.slice(1)}`
    return `../views/${filename}`
}

// 创建路由实例，使用哈希模式方便本地/文件协议
const router = createRouter({
    history: createWebHashHistory(),
    routes: normalizeRoutes(routesConfig as JsonRoute[]),
    // 保留浏览器原生的返回位置，否则回到顶部
    scrollBehavior(_to, _from, savedPosition) {
        if (savedPosition) return savedPosition
        return {left: 0, top: 0}
    },
})

// 页面标题前缀
const baseTitle = 'electron-vite-vue'

// 全局前置守卫：设置页面标题
router.beforeEach((to, _from, next) => {
    document.title = to.meta?.title ? `${to.meta.title} | ${baseTitle}` : baseTitle
    next()
})

// 导出路由实例
export default router

import {
    createRouter,            // 创建路由实例
    createWebHashHistory,    // 使用 hash 模式（兼容 file://）
} from 'vue-router'
import {unref} from 'vue' // 从 ref 中取值，避免 .value
import {routes} from './routes' // 静态路由表，菜单/权限共用
import {useUserStore} from '../stores/user' // 权限与登录态来源

const router = createRouter({
    history: createWebHashHistory(), // 哈希路由，适配 file:// 或本地
    routes,
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

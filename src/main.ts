import {createApp} from 'vue'
import {createPinia} from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import Antd from 'ant-design-vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import {useLocaleStore} from './stores/locale'
import {useThemeStore} from './stores/theme'
import 'ant-design-vue/dist/reset.css'
import './styles/theme.css'

// import './demos/ipc'
// If you want use Node.js, the`nodeIntegration` needs to be enabled in the Main process.
// import './demos/node'

const app = createApp(App)

// 创建 pinia 实例
const pinia = createPinia()
// pinia 持久化插件
pinia.use(piniaPersist)

// 挂载 pinia
app.use(pinia)

// 挂载国际化
app.use(i18n)

// 初始化语言（store 内部会同步 i18n）
useLocaleStore(pinia)

// 挂载 ant-design UI
app.use(Antd)

// 初始化主题（跟随系统 / 用户选择）
useThemeStore(pinia)

// 挂载路由
app.use(router)

app.mount('#app').$nextTick(() => {
    postMessage({payload: 'removeLoading'}, '*')
})

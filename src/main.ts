import {createApp} from 'vue'
import {createPinia} from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import Antd from 'ant-design-vue'
import App from './App.vue'
import 'ant-design-vue/dist/reset.css'

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

// 挂载 ant-design UI
app.use(Antd)

app.mount('#app').$nextTick(() => {
    postMessage({payload: 'removeLoading'}, '*')
})

import {defineStore} from 'pinia'
import {ref, watch} from 'vue'
import i18n from '../i18n'
import type {AppLocale} from '../i18n'

// 默认语言设置
// AppLocale 是项目中定义的语言类型（例如：'zh' | 'en'）
const defaultLocale: AppLocale = 'zh'
// 定义语言 Store
export const useLocaleStore = defineStore(
    // Store 的唯一标识 ID
    'locale',
    // 使用 setup 语法定义 Store
    () => {
        // 当前使用的语言
        // 初始化为默认语言
        const locale = ref<AppLocale>(defaultLocale)
        // 设置语言的方法
        // 用于在应用中切换语言
        function setLocale(newLocale: AppLocale) {
            // 更新当前语言
            locale.value = newLocale
        }

        // 监听语言变化
        // 作用：在应用启动或语言切换时
        //       将 Pinia 中的语言同步到 vue-i18n
        watch(
            // 被监听的响应式数据：当前语言
            locale,
            // 当语言发生变化时的回调函数
            newLocale => {
                // 将新的语言设置到 i18n 全局实例中
                // i18n.global.locale 是一个 Ref
                // 这里直接修改其 value
                // @ts-ignore 用于忽略类型检查（某些 i18n 版本下的类型问题）
                i18n.global.locale.value = newLocale
            },
            // immediate: true
            // 表示在监听器创建时立即执行一次回调
            // 确保刷新页面后，持久化的语言立刻生效
            {immediate: true}
        )
        // 向外暴露状态和方法
        return {
            // 当前语言
            locale,
            // 修改语言的方法
            setLocale
        }
    },
    // Pinia 持久化配置
    {
        persist: {
            // localStorage 中保存的 key
            key: 'locale-store',
            // 使用 localStorage 进行持久化
            storage: localStorage
        }
    }
)


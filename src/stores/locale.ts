import {defineStore} from 'pinia'
import {ref, watch} from 'vue'
import i18n from '../i18n'
import type {AppLocale} from '../i18n'

const defaultLocale: AppLocale = 'zh'

export const useLocaleStore = defineStore(
    'locale',
    () => {
        const locale = ref<AppLocale>(defaultLocale)

        function setLocale(newLocale: AppLocale) {
            locale.value = newLocale
        }

        // 启动时：把持久化的 locale 同步到 i18n
        watch(
            locale,
            newLocale => {
                // @ts-ignore
                i18n.global.locale.value = newLocale
            },
            {immediate: true}
        )

        return {locale, setLocale}
    },
    {
        persist: {
            key: 'locale-store',
            storage: localStorage
        }
    }
)

import {createI18n} from 'vue-i18n'
import en from './en'
import zh from './zh'

const messages = {
    en,
    zh
} as const

export type AppMessageSchema = typeof en
export type AppLocale = keyof typeof messages

const i18n = createI18n<
    AppMessageSchema,
    AppLocale
>({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'en',
    messages
})

export default i18n

const zh = {
  home: {
    title: 'Electron + Vite + Vue',
    description: '路由已集成，下面按钮演示路由跳转并可体验国际化。',
    apiTitle: '通过 API 跳转：',
    apiButton: '前往 Pinia Demo 页面',
    linkTitle: '通过路由链接跳转：',
    linkLabel: '跳转至 Pinia Demo',
    i18nTitle: '国际化演示',
    i18nTip: '切换语言，下面的文本会实时变化。',
    currentLanguage: '当前语言：{lang}',
    switchLabel: '切换到 {lang}'
  },
  localeName: {
    en: '英文',
    zh: '中文'
  }
} as const

export default zh

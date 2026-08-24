const zh = {
  home: {
    title: 'Electron + Vite + Vue',
    description: '路由已集成，可体验国际化和日志记录能力。',
    i18nTitle: '国际化演示',
    i18nTip: '切换语言，下面的文本会实时变化。',
    currentLanguage: '当前语言：{lang}',
    switchLabel: '切换到 {lang}',
    logTitle: '日志示例',
    logTip: '进入首页会自动记录一条日志，也可以点击下面按钮手动写入日志文件。',
    logInfoButton: '写入 Info 日志',
    logErrorButton: '写入 Error 日志'
  },
  localeName: {
    en: '英文',
    zh: '中文'
  }
} as const

export default zh

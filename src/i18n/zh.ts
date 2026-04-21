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
    switchLabel: '切换到 {lang}',
    logTitle: '日志示例',
    logTip: '进入首页会自动记录一条日志，也可以点击下面按钮手动写入日志文件。',
    logInfoButton: '写入 Info 日志',
    logErrorButton: '写入 Error 日志',
    jsonTitle: 'JSON 读写示例',
    jsonTip: '输入文件名和 JSON 内容，点击按钮执行读写。',
    jsonDirectory: '存储目录：{path}',
    jsonFileLabel: '文件名（可不带 .json）',
    jsonInputLabel: '待写入 JSON',
    jsonOutputLabel: '读取结果 JSON',
    jsonWriteButton: '写入 JSON',
    jsonReadButton: '读取 JSON',
    jsonInvalid: 'JSON 格式错误，请先修正后再写入。',
    jsonWriteSuccess: 'JSON 写入成功。',
    jsonReadSuccess: 'JSON 读取成功。',
    jsonDirectoryError: '获取 JSON 目录失败：{error}',
    jsonWriteError: 'JSON 写入失败：{error}',
    jsonReadError: 'JSON 读取失败：{error}'
  },
  localeName: {
    en: '英文',
    zh: '中文'
  }
} as const

export default zh

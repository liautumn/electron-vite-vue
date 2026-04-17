const en = {
  home: {
    title: 'Electron + Vite + Vue',
    description: 'Routing is integrated. Use the buttons below to try navigation and see i18n updates.',
    apiTitle: 'Navigate via API:',
    apiButton: 'Go to Pinia Demo Page',
    linkTitle: 'Navigate via router-link:',
    linkLabel: 'Go Pinia Demo',
    i18nTitle: 'Internationalization Demo',
    i18nTip: 'Toggle the language to update the text below.',
    currentLanguage: 'Current language: {lang}',
    switchLabel: 'Switch to {lang}',
    logTitle: 'Logging Demo',
    logTip: 'Opening the home page writes one log automatically. Use the buttons below to append more entries.',
    logInfoButton: 'Write Info Log',
    logErrorButton: 'Write Error Log'
  },
  localeName: {
    en: 'English',
    zh: 'Chinese'
  }
} as const

export default en

<script setup lang="ts">
import {computed, onMounted} from 'vue'
import {useI18n} from 'vue-i18n'
import {storeToRefs} from 'pinia'
import {useLocaleStore} from '../stores/locale'
import logger, {createLogger} from '../utils/logger'

defineOptions({ name: 'home' })

const {t} = useI18n()
const localeStore = useLocaleStore()
const {locale} = storeToRefs(localeStore)
const pageLog = createLogger('home-page')

const nextLocale = computed(() => (locale.value === 'zh' ? 'en' : 'zh'))
const toggleLocale = () => {
  const fromLocale = locale.value
  const toLocale = nextLocale.value

  localeStore.setLocale(toLocale)
  pageLog.info('Language switched', {
    from: fromLocale,
    to: toLocale,
  })
}
const currentLanguageText = computed(() =>
    t('home.currentLanguage', {lang: t(`localeName.${locale.value}`)})
)
const switchLabel = computed(() =>
    t('home.switchLabel', {lang: t(`localeName.${nextLocale.value}`)})
)

const emitInfoLog = () => {
  logger.info('Home page info log example')
}

const emitErrorLog = () => {
  const error = new Error('Home page log example error')
  pageLog.error('Home page error log example', error.message)
}

onMounted(() => {
  pageLog.info('Home page mounted', {
    locale: locale.value,
  })
})
</script>

<template>
  <div class="page workspace-page">
    <el-card shadow="never" class="hero">
      <div>
        <h1>{{ t('home.title') }}</h1>
        <p class="hero-text">{{ t('home.description') }}</p>
      </div>
    </el-card>

    <el-card shadow="never" class="card">
      <div class="card-section">
        <p class="card-title">{{ t('home.i18nTitle') }}</p>
        <p class="muted">{{ t('home.i18nTip') }}</p>
        <div class="language-row">
          <span>{{ currentLanguageText }}</span>
          <el-button type="primary" plain @click="toggleLocale">{{ switchLabel }}</el-button>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="card">
      <div class="card-section">
        <p class="card-title">{{ t('home.logTitle') }}</p>
        <p class="muted">{{ t('home.logTip') }}</p>
        <div class="log-actions">
          <el-button type="primary" @click="emitInfoLog">{{ t('home.logInfoButton') }}</el-button>
          <el-button type="danger" @click="emitErrorLog">{{ t('home.logErrorButton') }}</el-button>
        </div>
      </div>
    </el-card>

  </div>
</template>

<style scoped>
.page {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.hero {
  grid-column: 1 / -1;
  background: var(--el-bg-color);
  border-color: var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
}

.hero :deep(.el-card__body) {
  padding: 24px;
}

.eyebrow {
  color: var(--app-text-secondary);
  letter-spacing: 0;
  margin: 0 0 8px;
  text-transform: uppercase;
}

.hero h1 {
  font-size: 22px;
  margin: 0 0 8px;
}

.hero-text {
  margin: 0;
  max-width: 560px;
}

.card {
  min-width: 0;
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: var(--el-border-radius-base);
}

.card-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.language-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.log-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.muted {
  color: var(--app-text-secondary);
  margin: 0;
}

.link {
  color: var(--el-color-primary);
  text-decoration: none;
}

@media (max-width: 640px) {
  .page {
    grid-template-columns: minmax(0, 1fr);
  }

  .hero :deep(.el-card__body) {
    padding: 18px;
  }
}
</style>

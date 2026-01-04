<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {storeToRefs} from 'pinia'
import {useLocaleStore} from '../stores/locale'

const router = useRouter()
const {t} = useI18n()
const localeStore = useLocaleStore()
const {locale} = storeToRefs(localeStore)

const goPiniaDemo = () => {
  router.push({name: 'pinia-demo'})
}

const nextLocale = computed(() => (locale.value === 'zh' ? 'en' : 'zh'))
const toggleLocale = () => {
  localeStore.setLocale(nextLocale.value)
}
const currentLanguageText = computed(() =>
  t('home.currentLanguage', {lang: t(`localeName.${locale.value}`)})
)
const switchLabel = computed(() =>
  t('home.switchLabel', {lang: t(`localeName.${nextLocale.value}`)})
)
</script>

<template>
  <div class="page">
    <h1>{{ t('home.title') }}</h1>
    <p>{{ t('home.description') }}</p>

    <div class="card">
      <p>{{ t('home.apiTitle') }}</p>
      <a-button type="primary" @click="goPiniaDemo">{{ t('home.apiButton') }}</a-button>
    </div>

    <div class="card">
      <p>{{ t('home.linkTitle') }}</p>
      <router-link class="link" :to="{name: 'pinia-demo'}">
        {{ t('home.linkLabel') }}
      </router-link>
    </div>

    <div class="card">
      <p>{{ t('home.i18nTitle') }}</p>
      <p class="muted">{{ t('home.i18nTip') }}</p>
      <div class="language-row">
        <span>{{ currentLanguageText }}</span>
        <a-button @click="toggleLocale">{{ switchLabel }}</a-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
  margin: 32px auto;
  padding: 0 16px;
}

.card {
  background: #fff;
  padding: 16px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.link {
  color: #1677ff;
}

.muted {
  color: #666;
  margin-bottom: 8px;
}

.language-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
</style>

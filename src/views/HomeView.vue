<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {storeToRefs} from 'pinia'
import {useLocaleStore} from '../stores/locale'
import logger, {createLogger} from '../utils/logger'

defineOptions({ name: 'home' })

const router = useRouter()
const {t} = useI18n()
const localeStore = useLocaleStore()
const {locale} = storeToRefs(localeStore)
const pageLog = createLogger('home-page')

const goPiniaDemo = () => {
  router.push({name: 'pinia-demo'})
}

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

const jsonFileName = ref('home-demo')
const jsonInput = ref(
    JSON.stringify(
        {
          app: 'electron-vite-vue',
          language: locale.value,
          enabled: true,
        },
        null,
        2
    )
)
const jsonOutput = ref('')
const jsonDirectory = ref('')
const jsonStatus = ref('')

const toErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

const loadJsonDirectory = async () => {
  try {
    jsonDirectory.value = await window.json.getDirectory()
  } catch (error) {
    jsonStatus.value = t('home.jsonDirectoryError', {error: toErrorMessage(error)})
    pageLog.error('Failed to load JSON directory', error)
  }
}

const writeJsonDemo = async () => {
  try {
    const payload = JSON.parse(jsonInput.value) as Record<string, unknown>

    await window.json.write({
      fileName: jsonFileName.value,
      data: payload,
      pretty: true,
    })
    jsonStatus.value = t('home.jsonWriteSuccess')
    pageLog.info('JSON demo write success', {fileName: jsonFileName.value})
  } catch (error) {
    if (error instanceof SyntaxError) {
      jsonStatus.value = t('home.jsonInvalid')
    } else {
      jsonStatus.value = t('home.jsonWriteError', {error: toErrorMessage(error)})
    }
    pageLog.error('JSON demo write failed', error)
  }
}

const readJsonDemo = async () => {
  try {
    const result = await window.json.read<Record<string, unknown> | null>({
      fileName: jsonFileName.value,
      fallback: null,
    })

    jsonOutput.value = JSON.stringify(result, null, 2)
    jsonStatus.value = t('home.jsonReadSuccess')
    pageLog.info('JSON demo read success', {
      fileName: jsonFileName.value,
      exists: result !== null,
    })
  } catch (error) {
    jsonStatus.value = t('home.jsonReadError', {error: toErrorMessage(error)})
    pageLog.error('JSON demo read failed', error)
  }
}

onMounted(() => {
  pageLog.info('Home page mounted', {
    locale: locale.value,
  })
  void loadJsonDirectory()
})
</script>

<template>
  <div class="page">
    <div class="hero">
      <div>
        <p class="eyebrow">Quasar Renderer</p>
        <h1>{{ t('home.title') }}</h1>
        <p class="hero-text">{{ t('home.description') }}</p>
      </div>
      <q-btn color="primary" no-caps unelevated @click="goPiniaDemo">
        {{ t('home.apiButton') }}
      </q-btn>
    </div>

    <q-card flat bordered class="card">
      <q-card-section class="card-section">
        <p class="card-title">{{ t('home.apiTitle') }}</p>
        <q-btn color="primary" no-caps unelevated @click="goPiniaDemo">
          {{ t('home.apiButton') }}
        </q-btn>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="card">
      <q-card-section class="card-section">
        <p class="card-title">{{ t('home.linkTitle') }}</p>
        <router-link class="link" :to="{name: 'pinia-demo'}">
          {{ t('home.linkLabel') }}
        </router-link>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="card">
      <q-card-section class="card-section">
        <p class="card-title">{{ t('home.i18nTitle') }}</p>
        <p class="muted">{{ t('home.i18nTip') }}</p>
        <div class="language-row">
          <span>{{ currentLanguageText }}</span>
          <q-btn outline color="primary" no-caps @click="toggleLocale">{{ switchLabel }}</q-btn>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="card">
      <q-card-section class="card-section">
        <p class="card-title">{{ t('home.logTitle') }}</p>
        <p class="muted">{{ t('home.logTip') }}</p>
        <div class="log-actions">
          <q-btn color="primary" no-caps unelevated @click="emitInfoLog">{{ t('home.logInfoButton') }}</q-btn>
          <q-btn color="negative" no-caps unelevated @click="emitErrorLog">{{ t('home.logErrorButton') }}</q-btn>
        </div>
      </q-card-section>
    </q-card>

    <q-card flat bordered class="card">
      <q-card-section class="card-section">
        <p class="card-title">{{ t('home.jsonTitle') }}</p>
        <p class="muted">{{ t('home.jsonTip') }}</p>
        <p class="muted json-directory">{{ t('home.jsonDirectory', {path: jsonDirectory || '-'}) }}</p>

        <q-input
            v-model="jsonFileName"
            dense
            outlined
            :label="t('home.jsonFileLabel')"
        />

        <q-input
            v-model="jsonInput"
            autogrow
            outlined
            type="textarea"
            :label="t('home.jsonInputLabel')"
        />

        <div class="json-actions">
          <q-btn color="primary" no-caps unelevated @click="writeJsonDemo">
            {{ t('home.jsonWriteButton') }}
          </q-btn>
          <q-btn outline color="primary" no-caps @click="readJsonDemo">
            {{ t('home.jsonReadButton') }}
          </q-btn>
        </div>

        <q-input
            :model-value="jsonOutput"
            autogrow
            outlined
            readonly
            type="textarea"
            :label="t('home.jsonOutputLabel')"
        />

        <p v-if="jsonStatus" class="muted">{{ jsonStatus }}</p>
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.page {
  max-width: 760px;
  margin: 28px auto;
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hero {
  align-items: end;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.16), transparent 34%),
    linear-gradient(135deg, color-mix(in srgb, var(--app-surface) 92%, white), var(--app-surface));
  border: 1px solid var(--app-border);
  border-radius: 18px;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 24px;
}

.eyebrow {
  color: var(--app-text-secondary);
  letter-spacing: 0.12em;
  margin: 0 0 8px;
  text-transform: uppercase;
}

.hero h1 {
  margin: 0 0 8px;
}

.hero-text {
  margin: 0;
  max-width: 560px;
}

.card {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 16px;
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

.json-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.muted {
  color: var(--app-text-secondary);
  margin: 0;
}

.json-directory {
  word-break: break-all;
}

.link {
  color: var(--q-primary);
  text-decoration: none;
}

@media (max-width: 640px) {
  .hero {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

<script setup lang="ts">
import {computed} from 'vue'
import {storeToRefs} from 'pinia'
import {theme as antdTheme} from 'ant-design-vue'
import {useThemeStore, type ThemePreference} from './stores/theme'

const themeStore = useThemeStore()
const {preference, resolvedTheme} = storeToRefs(themeStore)

/** 主题选项 */
const themeOptions: { label: string; value: ThemePreference }[] = [
  {label: '跟随系统', value: 'system'},
  {label: '浅色', value: 'light'},
  {label: '暗黑', value: 'dark'}
]

/** 当前主题文案 */
const themeStatus = computed(() => {
  const themeText = resolvedTheme.value === 'dark' ? '暗黑' : '浅色'
  return preference.value === 'system'
      ? `系统：${themeText}`
      : `${themeText}模式`
})

/** Ant Design Vue 主题 */
const antdThemeConfig = computed(() => ({
  algorithm:
      resolvedTheme.value === 'dark'
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm
}))
</script>

<template>
  <a-config-provider :theme="antdThemeConfig">
    <div class="app">
      <header class="header">
        <div class="header-left">
          <span class="brand">Vue Router Demo</span>
          <nav class="nav">
            <router-link to="/">首页</router-link>
            <router-link to="/pinia-demo">Pinia Demo</router-link>
            <router-link to="/serialport-demo">Serialport Demo</router-link>
          </nav>
        </div>

        <div class="header-right">
          <div class="theme-switch">
            <a-segmented
                v-model:value="preference"
                :options="themeOptions"
                size="small"
            />
            <span class="theme-status">{{ themeStatus }}</span>
          </div>
        </div>
      </header>

      <main class="content">
        <router-view/>
      </main>
    </div>
  </a-config-provider>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid currentColor; /* 使用文字颜色，不加背景 */
}


.header-left,
.header-right,
.nav,
.theme-switch {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand {
  font-weight: 600;
  white-space: nowrap;
}

.nav a {
  text-decoration: none;
}

.nav a.router-link-active {
  text-decoration: underline;
}

.theme-switch {
  font-size: 13px;
  white-space: nowrap;
}

.theme-status {
  opacity: 0.7;
}

.content {
  flex: 1;
  padding: 16px;
}
</style>

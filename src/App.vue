<script setup lang="ts">
import {watch} from 'vue'
import {storeToRefs} from 'pinia'
import {Dark} from 'quasar'
import {useThemeStore, type ThemePreference} from './stores/theme'
import {useMenu} from './router/useMenu'

const themeStore = useThemeStore()
const {preference, resolvedTheme} = storeToRefs(themeStore)

/** 主题选项 */
const themeOptions: { label: string; value: ThemePreference }[] = [
  {label: '跟随系统', value: 'system'},
  {label: '浅色', value: 'light'},
  {label: '暗黑', value: 'dark'}
]

watch(resolvedTheme, (theme) => {
  Dark.set(theme === 'dark')
}, {immediate: true})

const {items, selectedKey, activeRootKey, navigate} = useMenu()
const isRootActive = (key: string) => activeRootKey.value === key
const isSelected = (key: string) => selectedKey.value === key

</script>
<template>
  <q-layout view="hHh lpR fFf" class="app-layout">
    <q-header class="app-header">
      <q-toolbar class="app-toolbar">
        <div class="nav-group">
          <template v-for="item in items" :key="item.key">
            <q-btn
              v-if="!item.children?.length"
              flat
              no-caps
              class="nav-btn"
              :class="{'nav-btn--active': isRootActive(item.key)}"
              :color="isRootActive(item.key) ? 'primary' : 'grey-7'"
              :disable="item.disabled"
              :label="item.label"
              @click="navigate(item)"
            />

            <q-btn-dropdown
              v-else
              flat
              auto-close
              no-caps
              class="nav-btn"
              :class="{'nav-btn--active': isRootActive(item.key)}"
              :color="isRootActive(item.key) ? 'primary' : 'grey-7'"
              :disable="item.disabled"
              :label="item.label"
            >
              <q-list dense class="nav-menu">
                <q-item
                  v-for="child in item.children"
                  :key="child.key"
                  clickable
                  :active="isSelected(child.key)"
                  :disable="child.disabled"
                  active-class="nav-item--active"
                  @click="navigate(child)"
                >
                  <q-item-section>{{ child.label }}</q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </template>
        </div>

        <q-space />

        <q-btn-toggle
          v-model="preference"
          class="theme-toggle"
          no-caps
          rounded
          unelevated
          toggle-color="primary"
          :options="themeOptions"
        />
      </q-toolbar>
    </q-header>

    <q-page-container class="app-page-container">
      <div class="app-content">
        <router-view/>
      </div>
    </q-page-container>

    <q-footer class="app-footer">
      <div class="app-footer__inner">
        electron-vite-vue demo ©2026 Created by autumn
      </div>
    </q-footer>
  </q-layout>
</template>
<style scoped>
.app-layout {
  min-height: 100vh;
}

.app-header {
  background: color-mix(in srgb, var(--app-header) 92%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--app-border);
  color: var(--text-color);
}

.app-toolbar {
  gap: 16px;
  min-height: 68px;
  padding: 0 20px;
}

.nav-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.nav-btn {
  border-radius: 999px;
  font-weight: 500;
  min-height: 38px;
  padding: 0 8px;
}

.nav-btn--active {
  background: color-mix(in srgb, var(--app-surface) 70%, var(--bg-color));
}

.nav-menu {
  min-width: 180px;
}

.theme-toggle {
  background: color-mix(in srgb, var(--app-surface) 82%, transparent);
  border: 1px solid var(--app-border);
  border-radius: 999px;
  padding: 4px;
}

.app-page-container {
  background: var(--bg-color);
}

.app-content {
  margin: 0 auto;
  max-width: 1440px;
  padding: 18px;
  width: 100%;
}

.app-footer {
  background: var(--app-header);
  border-top: 1px solid var(--app-border);
  color: var(--app-text-secondary);
}

.app-footer__inner {
  padding: 14px 18px;
  text-align: center;
}

@media (max-width: 900px) {
  .app-toolbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 14px 16px;
  }

  .nav-group {
    width: 100%;
  }

  .theme-toggle {
    width: 100%;
  }
}
</style>

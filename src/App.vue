<script setup lang="ts">
import {watch} from 'vue'
import { storeToRefs } from 'pinia'
import {useRoute, useRouter} from 'vue-router'
import {Monitor, Moon, Sunny} from '@element-plus/icons-vue'
import { useThemeStore, type ThemePreference } from './stores/theme'
import {menuItems} from './menu/menu'
import DeviceConnectionsControl from './components/DeviceConnectionsControl.vue'

const themeStore = useThemeStore()
const { preference, resolvedTheme } = storeToRefs(themeStore)

const themeOptions: { label: string; value: ThemePreference }[] = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '暗黑', value: 'dark' }
]

watch(
  resolvedTheme,
  (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  },
  { immediate: true }
)

const route = useRoute()
const router = useRouter()

const handleMenuSelect = (routeName: string) => {
  void router.push({name: routeName})
}
</script>

<template>
  <el-container class="app-layout">
    <el-aside class="app-sidebar" width="220px">
      <div class="app-brand">
        <div class="app-brand__mark">EV</div>
        <div>
          <strong>Electron Vite</strong>
          <span>Device Console</span>
        </div>
      </div>
      <el-scrollbar class="sidebar-scrollbar">
        <el-menu
          :default-active="String(route.name ?? '')"
          class="app-menu"
          @select="handleMenuSelect"
        >
          <template v-for="item in menuItems" :key="item.routeName">
            <el-menu-item v-if="!item.children?.length" :index="item.routeName">
              {{ item.label }}
            </el-menu-item>
            <el-sub-menu v-else :index="item.routeName">
              <template #title>{{ item.label }}</template>
              <el-menu-item
                v-for="child in item.children"
                :key="child.routeName"
                :index="child.routeName"
              >
                {{ child.label }}
              </el-menu-item>
            </el-sub-menu>
          </template>
        </el-menu>
      </el-scrollbar>
    </el-aside>

    <el-container class="app-workspace">
      <el-header class="app-header">
        <div class="app-toolbar">
          <div class="page-context">
            <span class="page-context__label">当前模块</span>
            <strong>{{ route.matched[0]?.meta.title ?? '工作台' }}</strong>
          </div>
        <div class="toolbar-actions">
          <DeviceConnectionsControl />
          <el-segmented v-model="preference" :options="themeOptions" class="theme-toggle">
            <template #default="{item}">
              <div class="theme-option">
                <el-icon>
                  <Monitor v-if="item.value === 'system'" />
                  <Sunny v-else-if="item.value === 'light'" />
                  <Moon v-else />
                </el-icon>
                <span>{{ item.label }}</span>
              </div>
            </template>
          </el-segmented>
        </div>
      </div>
      </el-header>

      <el-main class="app-page-container">
        <div class="app-content">
          <router-view />
        </div>
      </el-main>

      <el-footer class="app-footer">
        <div class="app-footer__inner">electron-vite-vue demo ©2026 Created by autumn</div>
      </el-footer>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-layout {
  height: 100vh;
  min-height: 100vh;
  background: var(--el-bg-color-page);
}

.app-sidebar {
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-light);
  display: flex;
  flex-direction: column;
  transition: width var(--el-transition-duration);
}

.app-brand {
  align-items: center;
  border-bottom: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex: none;
  gap: 12px;
  height: 68px;
  padding: 0 18px;
}

.app-brand__mark {
  align-items: center;
  background: var(--el-color-primary);
  border-radius: var(--el-border-radius-base);
  color: white;
  display: flex;
  flex: none;
  font-size: 13px;
  font-weight: 700;
  height: 34px;
  justify-content: center;
  width: 34px;
}

.app-brand strong,
.app-brand span {
  display: block;
  letter-spacing: 0;
  white-space: nowrap;
}

.app-brand strong {
  font-size: 15px;
}

.app-brand span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 3px;
}

.sidebar-scrollbar {
  flex: 1;
  min-height: 0;
}

.app-workspace {
  min-width: 0;
}

.app-header {
  height: auto;
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-primary);
  padding: 0 20px;
}

.app-toolbar {
  align-items: center;
  display: flex;
  gap: 16px;
  min-height: 68px;
  justify-content: space-between;
}

.app-menu {
  background: transparent;
  border-right: 0;
  padding: 10px 8px;
}

.app-menu :deep(.el-menu-item),
.app-menu :deep(.el-sub-menu__title) {
  height: auto;
  line-height: 1.4;
  min-height: 48px;
  white-space: normal;
}

.page-context {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.page-context__label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  flex: none;
  gap: 12px;
}

.theme-toggle {
  flex: none;
}

.theme-option {
  align-items: center;
  display: flex;
  gap: 6px;
}

.app-page-container {
  background: var(--el-bg-color-page);
  min-width: 0;
  overflow: auto;
  padding: 18px;
}

.app-content {
  margin: 0 auto;
  max-width: 1440px;
  width: 100%;
}

.app-footer {
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-secondary);
  height: auto;
}

.app-footer__inner {
  padding: 14px 18px;
  text-align: center;
}

@media (max-width: 900px) {
  .app-sidebar {
    width: 220px !important;
  }

  .app-brand {
    padding: 0 12px;
  }

  .app-brand__mark {
    display: none;
  }

  .app-toolbar {
    align-items: stretch;
    flex-direction: column;
    padding: 8px 0 12px;
  }

  .toolbar-actions {
    flex-wrap: wrap;
    justify-content: space-between;
  }

  .theme-option span {
    display: none;
  }
}
</style>

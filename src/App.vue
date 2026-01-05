<script setup lang="ts">
import {computed, h, ref} from 'vue'
import {useRouter} from 'vue-router'
import {storeToRefs} from 'pinia'
import {MenuProps, theme as antdTheme} from 'ant-design-vue'
import {AppstoreOutlined} from '@ant-design/icons-vue';
import {useThemeStore, type ThemePreference} from './stores/theme'

const router = useRouter()

const themeStore = useThemeStore()
const {preference, resolvedTheme} = storeToRefs(themeStore)

/** 主题选项 */
const themeOptions: { label: string; value: ThemePreference }[] = [
  {label: '跟随系统', value: 'system'},
  {label: '浅色', value: 'light'},
  {label: '暗黑', value: 'dark'}
]

/** Ant Design Vue 主题 */
const antdThemeConfig = computed(() => ({
  algorithm:
      resolvedTheme.value === 'dark'
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm
}))

const items = ref<MenuProps['items']>([
  {
    key: '/',
    icon: () => h(AppstoreOutlined),
    label: '首页',
    title: '首页',
  },
  {
    key: '/pinia-demo',
    icon: () => h(AppstoreOutlined),
    label: 'Pinia',
    title: 'Pinia',
  },
  {
    key: '/serialport-demo',
    icon: () => h(AppstoreOutlined),
    label: 'Serialport',
    title: 'Serialport',
  },
]);

/** 当前选中的菜单 key */
const selectedKeys = ref<string[]>(['/']);

/** 菜单点击跳转 */
function onMenuClick({key}: { key: string }) {
  router.push(key)
}
</script>
<template>
  <a-config-provider :theme="antdThemeConfig">
    <a-layout>
      <!-- Header -->
      <a-layout-header class="app-header">
        <a-menu
            v-model:selectedKeys="selectedKeys"
            mode="horizontal"
            :items="items"
            @click="onMenuClick"
        >
          <!-- 右侧插槽 -->
          <template #extra>
            <a-segmented
                v-model:value="preference"
                :options="themeOptions"
                size="small"
            />
          </template>
        </a-menu>
      </a-layout-header>
      <!-- Content -->
      <a-layout-content>
        <router-view/>
      </a-layout-content>
    </a-layout>
  </a-config-provider>
</template>
<style scoped>
.app-header {
  padding: 0;
  background: transparent;
}

/* Menu 占满 Header */
.app-header :deep(.ant-menu) {
  border-bottom: none;
}
</style>


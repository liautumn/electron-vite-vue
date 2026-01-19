<script setup lang="ts">
import {useRouter} from 'vue-router'

defineOptions({ name: 'not-found' })

const router = useRouter()

const goHome = () => {
  router.replace({name: 'home'})
}
</script>

<template>
  <div class="not-found">
    <div class="code">404</div>
    <p class="message">页面不存在或者已被移动</p>
    <div class="actions">
      <a-button type="primary" @click="goHome">返回首页</a-button>
      <router-link class="link" to="/">回到首页</router-link>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 320px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.code {
  font-size: 64px;
  font-weight: 700;
  letter-spacing: 4px;
}

.message {
  color: #666;
}

.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.link {
  color: var(--app-primary, #1677ff);
}
</style>

<script setup lang="ts">
import {useRouter} from 'vue-router'

const router = useRouter()

const goPiniaDemo = () => {
  router.push({name: 'pinia-demo'})
}
</script>

<template>
  <div class="page">
    <h1>Electron + Vite + Vue</h1>
    <p>路由已集成，下面按钮演示路由跳转。</p>

    <div class="card">
      <p>通过 API 跳转：</p>
      <a-button type="primary" @click="goPiniaDemo">前往 Pinia Demo 页面</a-button>
    </div>

    <div class="card">
      <p>通过路由链接跳转：</p>
      <router-link class="link" :to="{name: 'pinia-demo'}">Go Pinia Demo</router-link>
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
</style>

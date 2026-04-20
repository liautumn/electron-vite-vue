<script setup lang="ts">
import {useRouter} from 'vue-router'
import {useUserStore} from "../stores/user";

defineOptions({ name: 'pinia-demo' })

const router = useRouter()

const goHome = () => {
  router.push({name: 'home'})
}

const userStore = useUserStore()

function setData() {
  userStore.setName('Tom')
  userStore.setToken('1234567890')
}
</script>

<template>
  <div class="page">
    <q-card flat bordered class="panel">
      <q-card-section class="panel-section">
        <div class="panel-actions">
          <q-btn outline color="primary" no-caps @click="goHome">返回首页</q-btn>
          <q-btn color="primary" no-caps unelevated @click="setData">一键赋值</q-btn>
        </div>

        <div>
          <h2>Pinio Demo</h2>
          <p>姓名：{{ userStore.getName }}</p>
          <p>Token：{{ userStore.getToken }}</p>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  justify-content: center;
  padding: 24px 12px;
}

.panel {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: 18px;
  max-width: 520px;
  width: 100%;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
</style>

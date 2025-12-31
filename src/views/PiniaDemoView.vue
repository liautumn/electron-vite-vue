<script setup lang="ts">
import {useRouter} from 'vue-router'
import {useUserStore} from "../stores/user";

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
    <div class="container">
      <a-space class="container" size="large">
        <a-button @click="goHome">返回首页</a-button>
        <h2>Pinio Demo</h2>
        <a-button @click="setData" type="primary">一键赋值</a-button>
        <p>姓名：{{ userStore.getName }}</p>
        <p>Token：{{ userStore.getToken }}</p>
      </a-space>
    </div>
  </div>
</template>

<style scoped>

.container {
  display: flex;
  justify-content: center;
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: center;
}

</style>

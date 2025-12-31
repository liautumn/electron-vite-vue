<script setup lang="ts">
import {useUserStore} from "../stores/user";

const userStore = useUserStore()

function setData() {
  userStore.setName('Tom')
  userStore.setToken('1234567890')
}

</script>

<template>
  <div class="container">
    <h2>pinia demo:</h2>
    <a-button @click="setData">一键赋值</a-button>
    <p>姓名：{{ userStore.getName }}</p>
    <p>Token：{{ userStore.getToken }}</p>
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

<script setup lang="ts">
import {useUserStore} from "../stores/user";

const userStore = useUserStore()

function setData(){
  userStore.setName('Tom')
  userStore.setToken('1234567890')
}

</script>

<template>
  <div>
    <h2>pinia demo:</h2>
    <button @click="setData">一键赋值</button>
    <p>姓名：{{userStore.getName}}</p>
    <p>Token：{{userStore.getToken}}</p>
  </div>
</template>

<style>
</style>

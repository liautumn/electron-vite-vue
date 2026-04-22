<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    connectedSerialCount?: number
    connectedTcpCount?: number
  }>(),
  {
    connectedSerialCount: 0,
    connectedTcpCount: 0
  }
)

const emit = defineEmits<{
  click: []
}>()

const label = computed(
  () => `设备连接 串口:${props.connectedSerialCount} TCP:${props.connectedTcpCount}`
)
</script>

<template>
  <q-btn outline no-caps color="primary" icon="settings" :label="label" @click="emit('click')" />
</template>

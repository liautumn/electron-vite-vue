<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    connectedRfidCount?: number
    connectedLockCount?: number
  }>(),
  {
    connectedRfidCount: 0,
    connectedLockCount: 0
  }
)

const emit = defineEmits<{
  click: []
}>()

const label = computed(
  () => `设备设置 RFID:${props.connectedRfidCount} Lock:${props.connectedLockCount}`
)
</script>

<template>
  <q-btn outline no-caps color="primary" icon="settings" :label="label" @click="emit('click')" />
</template>

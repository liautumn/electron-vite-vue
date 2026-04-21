<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    connectedRfidCount?: number
    connectedPadCount?: number
  }>(),
  {
    connectedRfidCount: 0,
    connectedPadCount: 0
  }
)

const emit = defineEmits<{
  click: []
}>()

const label = computed(
  () => `设备设置 RFID:${props.connectedRfidCount} PAD:${props.connectedPadCount}`
)
</script>

<template>
  <q-btn outline no-caps color="primary" icon="settings" :label="label" @click="emit('click')" />
</template>

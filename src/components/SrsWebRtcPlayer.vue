<template>
  <div class="srs-player">
    <video
      ref="videoRef"
      autoplay
      playsinline
      muted
      controls
      class="video"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'

/**
 * props
 * url 示例：
 * http://10.160.240.67:1985/rtc/v1/whep/?app=live&stream=livestream
 */
interface Props {
  url: string
}

const props = defineProps<Props>()

const videoRef = ref<HTMLVideoElement | null>(null)
let pc: RTCPeerConnection | null = null

async function startPlay() {
  if (!videoRef.value) return

  // 清理旧连接
  if (pc) {
    pc.close()
    pc = null
  }

  pc = new RTCPeerConnection()

  pc.ontrack = (event) => {
    videoRef.value!.srcObject = event.streams[0]
  }

  // ⚠️ 关键：强制 BUNDLE / Unified Plan
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.addTransceiver('video', { direction: 'recvonly' })

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  const res = await fetch(props.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp'
    },
    body: offer.sdp
  })

  if (!res.ok) {
    throw new Error(`WHEP request failed: ${res.status}`)
  }

  const answerSdp = await res.text()

  await pc.setRemoteDescription({
    type: 'answer',
    sdp: answerSdp
  })
}

onMounted(() => {
  startPlay().catch(err => {
    console.error('WebRTC play error:', err)
  })
})

onBeforeUnmount(() => {
  if (pc) {
    pc.close()
    pc = null
  }
})

// 如果 URL 变化，重新拉流
watch(() => props.url, () => {
  startPlay()
})
</script>

<style scoped>
.srs-player {
  width: 100%;
  height: 100%;
  background: #000;
}

.video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>

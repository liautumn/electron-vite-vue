<template>
  <div style="width: 800px; height: 450px;">
    <SrsWebRtcPlayer :url="webrtcUrl"/>
  </div>
</template>

<script setup lang="ts">
import SrsWebRtcPlayer from "../components/SrsWebRtcPlayer.vue";
import {ref} from "vue";

const webrtcUrl = ref('http://10.160.240.67:1985/rtc/v1/whep/?app=live&stream=livestream')
</script>

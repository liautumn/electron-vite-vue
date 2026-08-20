<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import type {
  SenseVoiceRecognitionResult,
  SenseVoiceStatus,
} from '../../shared/types/sensevoice'

defineOptions({name: 'sensevoice-demo'})

type AudioResources = {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: AudioWorkletNode
  sink: GainNode
}

const status = ref<SenseVoiceStatus>({
  state: 'missing',
  modelAvailable: false,
  engineReady: false,
  configPath: '',
  modelPath: '',
  tokensPath: '',
})
const inputDevices = ref<MediaDeviceInfo[]>([])
const selectedDeviceId = ref<string | null>(null)
const committedSegments = ref<string[]>([])
const partialText = ref('')
const errorMessage = ref('')
const audioLevel = ref(0)
const isStarting = ref(false)
const isStopping = ref(false)
const lastInferenceMs = ref<number | null>(null)
const lastAudioDurationMs = ref<number | null>(null)
const sampleRate = ref<number | null>(null)
const transcriptOutput = ref<HTMLElement | null>(null)
let audioResources: AudioResources | null = null
let flushResolver: (() => void) | null = null
let followTranscript = true
let pageActive = false
let audioLifecycleGeneration = 0

const isRecording = computed(() => status.value.state === 'recording')
const isBusy = computed(() =>
  isStarting.value || isStopping.value || status.value.state === 'loading'
)
const transcript = computed(() => {
  const sections = committedSegments.value.slice()
  if (partialText.value) sections.push(partialText.value)
  return sections.join('\n')
})
const deviceOptions = computed(() => inputDevices.value.map((device, index) => ({
  label: device.label || `麦克风 ${index + 1}`,
  value: device.deviceId,
})))
const statusLabel = computed(() => {
  if (status.value.state === 'missing') return '模型未配置'
  if (status.value.state === 'loading') return '引擎加载中'
  if (status.value.state === 'recording') return '识别中'
  if (status.value.state === 'error') return '异常'
  return status.value.engineReady ? '引擎就绪' : '模型就绪'
})
const statusColor = computed(() => {
  if (status.value.state === 'recording') return 'negative'
  if (status.value.state === 'error' || status.value.state === 'missing') return 'warning'
  if (status.value.state === 'loading') return 'primary'
  return 'positive'
})

watch(transcript, async () => {
  await nextTick()
  if (!followTranscript || !transcriptOutput.value) return
  transcriptOutput.value.scrollTop = transcriptOutput.value.scrollHeight
})

const normalizeError = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return '麦克风权限被拒绝'
  if (error instanceof DOMException && error.name === 'NotFoundError') return '未检测到可用的麦克风'
  if (error instanceof DOMException && error.name === 'NotReadableError') return '麦克风无法读取，可能正被其他应用占用'
  if (error instanceof DOMException && error.name === 'OverconstrainedError') return '选择的麦克风当前不可用'
  if (error instanceof Error) return error.message
  return String(error)
}

const refreshDevices = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const devices = await navigator.mediaDevices.enumerateDevices()
  inputDevices.value = devices.filter(device => device.kind === 'audioinput')
  if (!selectedDeviceId.value && inputDevices.value.length) {
    selectedDeviceId.value = inputDevices.value[0].deviceId
  }
}

const releaseAudioResources = async () => {
  const resources = audioResources
  audioResources = null
  if (!resources) return

  resources.processor.disconnect()
  resources.source.disconnect()
  resources.sink.disconnect()
  resources.stream.getTracks().forEach(track => track.stop())
  await resources.context.close().catch(() => undefined)
  audioLevel.value = 0
  sampleRate.value = null
}

const startRecording = async () => {
  if (isBusy.value || isRecording.value) return
  if (!status.value.modelAvailable) {
    errorMessage.value = status.value.message
      ?? `请先在配置文件中指定模型路径：${status.value.configPath}`
    return
  }

  isStarting.value = true
  errorMessage.value = ''
  const generation = ++audioLifecycleGeneration
  const isCurrentLifecycle = () => pageActive && generation === audioLifecycleGeneration
  let pendingStream: MediaStream | null = null
  let pendingContext: AudioContext | null = null
  try {
    const microphonePermission = await window.senseVoice.requestMicrophoneAccess()
    if (!isCurrentLifecycle()) return
    if (microphonePermission === 'denied') {
      errorMessage.value = '麦克风权限被拒绝，请在系统设置中允许后重启应用'
      return
    }
    if (microphonePermission === 'restricted') {
      errorMessage.value = '麦克风访问受到系统限制'
      return
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedDeviceId.value ? {exact: selectedDeviceId.value} : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    pendingStream = stream
    if (!isCurrentLifecycle()) {
      stream.getTracks().forEach(track => track.stop())
      pendingStream = null
      return
    }
    await refreshDevices()
    if (!isCurrentLifecycle()) {
      stream.getTracks().forEach(track => track.stop())
      pendingStream = null
      return
    }

    const context = new AudioContext({latencyHint: 'interactive'})
    pendingContext = context
    await context.audioWorklet.addModule(
      new URL('audio-worklets/sensevoice-pcm.js', window.location.href).toString()
    )
    await context.resume()
    if (!isCurrentLifecycle()) {
      stream.getTracks().forEach(track => track.stop())
      pendingStream = null
      await context.close().catch(() => undefined)
      pendingContext = null
      return
    }

    const source = context.createMediaStreamSource(stream)
    const processor = new AudioWorkletNode(context, 'sensevoice-pcm')
    const sink = context.createGain()
    sink.gain.value = 0
    processor.port.onmessage = (event: MessageEvent<{
      samples?: Float32Array
      rms?: number
      flushed?: boolean
    }>) => {
      if (event.data.flushed) {
        flushResolver?.()
        flushResolver = null
      }
      if (isCurrentLifecycle() && event.data.samples?.length) {
        audioLevel.value = Math.min(Math.max((event.data.rms ?? 0) * 8, 0), 1)
        window.senseVoice.pushAudio({
          sampleRate: context.sampleRate,
          samples: event.data.samples,
        })
      }
    }

    audioResources = {stream, context, source, processor, sink}
    status.value = await window.senseVoice.start(context.sampleRate)
    if (!isCurrentLifecycle()) {
      await releaseAudioResources()
      return
    }
    sampleRate.value = context.sampleRate
    source.connect(processor)
    processor.connect(sink)
    sink.connect(context.destination)
  } catch (error) {
    errorMessage.value = normalizeError(error)
    if (!audioResources) {
      pendingStream?.getTracks().forEach(track => track.stop())
      await pendingContext?.close().catch(() => undefined)
    }
    await releaseAudioResources()
  } finally {
    isStarting.value = false
  }
}

const flushAudio = async () => {
  if (!audioResources) return
  await new Promise<void>(resolve => {
    const timeout = window.setTimeout(resolve, 300)
    flushResolver = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    audioResources?.processor.port.postMessage('flush')
  })
}

const stopRecording = async () => {
  if (isStopping.value || !isRecording.value) return
  isStopping.value = true
  errorMessage.value = ''
  try {
    await flushAudio()
    await releaseAudioResources()
    status.value = await window.senseVoice.stop()
  } catch (error) {
    errorMessage.value = normalizeError(error)
  } finally {
    isStopping.value = false
  }
}

const toggleRecording = () => {
  if (isRecording.value) {
    void stopRecording()
  } else {
    void startRecording()
  }
}

const clearTranscript = async () => {
  errorMessage.value = ''
  followTranscript = true
  committedSegments.value = []
  partialText.value = ''
  lastInferenceMs.value = null
  lastAudioDurationMs.value = null
  try {
    status.value = await window.senseVoice.reset()
  } catch (error) {
    errorMessage.value = normalizeError(error)
  }
}

const handleTranscriptScroll = () => {
  const output = transcriptOutput.value
  if (!output) return
  followTranscript = output.scrollHeight - output.scrollTop - output.clientHeight < 24
}

const handleResult = (result: SenseVoiceRecognitionResult) => {
  lastInferenceMs.value = result.inferenceMs
  lastAudioDurationMs.value = result.audioDurationMs
  if (result.kind === 'partial') {
    partialText.value = result.text
    return
  }
  if (result.text) committedSegments.value.push(result.text)
  partialText.value = ''
}

const disposers: Array<() => void> = []

onMounted(async () => {
  pageActive = true
  disposers.push(
    window.senseVoice.onStatus((nextStatus: SenseVoiceStatus) => {
      status.value = nextStatus
    }),
    window.senseVoice.onResult(handleResult),
    window.senseVoice.onError((message: string) => {
      errorMessage.value = message
    })
  )

  try {
    const nextStatus = await window.senseVoice.initialize()
    if (!pageActive) return
    status.value = nextStatus
    if (!status.value.modelAvailable && status.value.message) {
      errorMessage.value = status.value.message
    }
    await refreshDevices()
  } catch (error) {
    if (pageActive) errorMessage.value = normalizeError(error)
  }
})

onBeforeUnmount(() => {
  pageActive = false
  audioLifecycleGeneration += 1
  disposers.forEach(dispose => dispose())
  void releaseAudioResources()
    .then(() => window.senseVoice.dispose())
    .catch(error => {
      console.error('Failed to dispose SenseVoice', error)
    })
})
</script>

<template>
  <main class="sensevoice-page">
    <header class="page-heading">
      <div>
        <h1>SenseVoice 本地语音识别</h1>
        <div class="engine-line">SenseVoice · sherpa-onnx · CPU</div>
      </div>
      <q-chip square dense :color="statusColor" text-color="white" :icon="isRecording ? 'graphic_eq' : 'memory'">
        {{ statusLabel }}
      </q-chip>
    </header>

    <section class="model-bar" :class="{'model-bar--missing': !status.modelAvailable}">
      <div class="model-info">
        <div class="model-copy">
          <div class="model-name">SenseVoice 模型</div>
          <div class="model-path" :title="status.modelPath || status.configPath">
            {{ status.modelPath || `配置文件：${status.configPath}` }}
          </div>
        </div>
      </div>
      <q-icon
        :name="status.modelAvailable ? 'check_circle' : 'warning_amber'"
        :color="status.modelAvailable ? 'positive' : 'warning'"
        size="22px"
      />
    </section>

    <q-banner v-if="errorMessage" rounded class="error-banner" inline-actions>
      <template #avatar><q-icon name="error_outline" color="negative" /></template>
      {{ errorMessage }}
      <template #action>
        <q-btn flat round dense icon="close" aria-label="关闭错误" @click="errorMessage = ''">
          <q-tooltip>关闭</q-tooltip>
        </q-btn>
      </template>
    </q-banner>

    <div class="workspace-grid">
      <section class="control-pane">
        <div class="section-heading">
          <h2>麦克风</h2>
          <span>{{ sampleRate ? `${sampleRate / 1000} kHz` : '待机' }}</span>
        </div>

        <q-select
          v-model="selectedDeviceId"
          outlined
          dense
          emit-value
          map-options
          :options="deviceOptions"
          label="输入设备"
          :disable="isRecording || isBusy"
        >
          <template #prepend><q-icon name="mic_external_on" /></template>
        </q-select>

        <div class="level-wrap" aria-label="麦克风音量">
          <div class="level-track">
            <div class="level-value" :style="{transform: `scaleX(${audioLevel})`} " />
          </div>
        </div>

        <div class="record-control">
          <q-btn
            round
            unelevated
            size="24px"
            :color="isRecording ? 'negative' : 'primary'"
            :icon="isRecording ? 'stop' : 'mic'"
            :loading="isStarting || isStopping"
            :disable="isBusy"
            :aria-label="isRecording ? '停止识别' : '开始识别'"
            @click="toggleRecording"
          >
            <q-tooltip>{{ isRecording ? '停止识别' : '开始识别' }}</q-tooltip>
          </q-btn>
          <div class="record-state">{{ isRecording ? '正在聆听' : '准备录音' }}</div>
        </div>

        <dl class="metrics">
          <div>
            <dt>识别延迟</dt>
            <dd>{{ lastInferenceMs === null ? '—' : `${lastInferenceMs} ms` }}</dd>
          </div>
          <div>
            <dt>当前语句</dt>
            <dd>{{ lastAudioDurationMs === null ? '—' : `${(lastAudioDurationMs / 1000).toFixed(1)} s` }}</dd>
          </div>
          <div>
            <dt>已确认</dt>
            <dd>{{ committedSegments.length }} 句</dd>
          </div>
        </dl>
      </section>

      <section class="transcript-pane">
        <div class="section-heading transcript-heading">
          <h2>识别结果</h2>
          <q-btn
            flat
            round
            dense
            icon="delete_outline"
            aria-label="清空识别结果"
            :disable="!transcript"
            @click="clearTranscript"
          >
            <q-tooltip>清空</q-tooltip>
          </q-btn>
        </div>
        <div
          ref="transcriptOutput"
          class="transcript-output"
          role="log"
          aria-label="识别结果"
          @scroll="handleTranscriptScroll"
        >
          <div v-if="transcript" class="transcript-text">{{ transcript }}</div>
          <div v-else class="transcript-placeholder">等待语音输入</div>
        </div>
        <div v-if="partialText" class="partial-indicator">
          <span /> 当前句
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.sensevoice-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: calc(90vh - 128px);
  min-height: calc(90dvh - 128px);
}

.page-heading,
.section-heading,
.model-bar,
.model-info,
.record-control {
  align-items: center;
  display: flex;
}

.page-heading {
  justify-content: space-between;
  min-height: 44px;
}

h1,
h2 {
  letter-spacing: 0;
  margin: 0;
}

h1 {
  font-size: 21px;
  font-weight: 650;
}

h2 {
  font-size: 16px;
  font-weight: 650;
}

.engine-line,
.model-path,
.section-heading span,
.record-state,
.metrics dt {
  color: var(--app-text-secondary);
}

.engine-line {
  font-size: 12px;
  margin-top: 1px;
}

.model-bar {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--q-positive);
  border-radius: 6px;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  min-height: 52px;
  padding: 8px 12px;
}

.model-bar--missing {
  border-left-color: var(--q-warning);
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-copy {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  min-width: 0;
  width: 100%;
}

.model-name {
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 600;
}

.model-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  flex: 1 1 320px;
  font-size: 11px;
  max-width: min(62vw, 820px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-banner {
  background: color-mix(in srgb, var(--q-negative) 10%, var(--app-surface));
  border: 1px solid color-mix(in srgb, var(--q-negative) 28%, transparent);
}

.workspace-grid {
  display: grid;
  flex: 1 1 360px;
  gap: 10px;
  grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
  min-height: 360px;
}

.control-pane,
.transcript-pane {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 6px;
  min-height: 0;
  padding: 14px;
}

.control-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-heading {
  justify-content: space-between;
  min-height: 26px;
}

.section-heading span {
  font-size: 12px;
}

.level-wrap {
  padding: 0;
}

.level-track {
  background: color-mix(in srgb, var(--app-border) 72%, transparent);
  border-radius: 3px;
  height: 7px;
  overflow: hidden;
}

.level-value {
  background: var(--q-positive);
  height: 100%;
  transform-origin: left center;
  transition: transform 80ms linear;
  width: 100%;
}

.record-control {
  flex: 1;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  min-height: 112px;
}

.record-state {
  font-size: 13px;
}

.metrics {
  border-top: 1px solid var(--app-border);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 0;
  padding-top: 10px;
}

.metrics div {
  min-width: 0;
  text-align: center;
}

.metrics div + div {
  border-left: 1px solid var(--app-border);
}

.metrics dt {
  font-size: 11px;
}

.metrics dd {
  font-size: 13px;
  font-weight: 600;
  margin: 4px 0 0;
}

.transcript-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.transcript-heading {
  margin-bottom: 8px;
}

.transcript-output {
  border: 1px solid var(--app-border);
  border-radius: 4px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  scrollbar-gutter: stable;
}

.transcript-text,
.transcript-placeholder {
  font-size: 17px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.transcript-placeholder {
  color: var(--app-text-secondary);
}

.partial-indicator {
  align-items: center;
  color: var(--app-text-secondary);
  display: flex;
  font-size: 11px;
  gap: 7px;
  justify-content: flex-end;
  margin-top: 6px;
}

.partial-indicator span {
  animation: pulse 1.2s ease-in-out infinite;
  background: var(--q-negative);
  border-radius: 50%;
  height: 7px;
  width: 7px;
}

@keyframes pulse {
  50% { opacity: 0.35; }
}

@media (max-width: 860px) {
  .sensevoice-page {
    min-height: auto;
  }

  .workspace-grid {
    flex-basis: auto;
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(320px, 50vh);
  }

  .record-control {
    min-height: 96px;
  }

  .model-path {
    flex-basis: 100%;
    max-width: 78vw;
  }
}
</style>

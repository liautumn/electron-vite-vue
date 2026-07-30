<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useQuasar} from 'quasar'
import type {
  SenseVoiceDownloadProgress,
  SenseVoiceRecognitionResult,
  SenseVoiceStatus,
} from '../types/sensevoice'

defineOptions({name: 'sensevoice-demo'})

type AudioResources = {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: AudioWorkletNode
  sink: GainNode
}

const $q = useQuasar()
const status = ref<SenseVoiceStatus>({
  state: 'missing',
  modelAvailable: false,
  engineReady: false,
  modelDirectory: '',
})
const downloadProgress = ref<SenseVoiceDownloadProgress | null>(null)
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

const isRecording = computed(() => status.value.state === 'recording')
const isDownloading = computed(() => status.value.state === 'downloading')
const isBusy = computed(() => isStarting.value || isStopping.value || isDownloading.value)
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
  if (status.value.state === 'missing') return '模型未安装'
  if (status.value.state === 'downloading') return '模型下载中'
  if (status.value.state === 'loading') return '引擎加载中'
  if (status.value.state === 'recording') return '识别中'
  if (status.value.state === 'error') return '异常'
  return status.value.engineReady ? '引擎就绪' : '模型就绪'
})
const statusColor = computed(() => {
  if (status.value.state === 'recording') return 'negative'
  if (status.value.state === 'error' || status.value.state === 'missing') return 'warning'
  if (status.value.state === 'loading' || status.value.state === 'downloading') return 'primary'
  return 'positive'
})
const progressLabel = computed(() => {
  const progress = downloadProgress.value
  if (!progress) return ''
  if (progress.stage === 'extract') return '正在解压模型'
  if (progress.stage === 'complete') return '模型下载完成'
  return `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`
})

watch(transcript, async () => {
  await nextTick()
  if (!followTranscript || !transcriptOutput.value) return
  transcriptOutput.value.scrollTop = transcriptOutput.value.scrollHeight
})

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const normalizeError = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return '麦克风权限被拒绝'
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

const downloadModel = async () => {
  errorMessage.value = ''
  downloadProgress.value = {
    stage: 'download',
    receivedBytes: 0,
    totalBytes: 0,
    percent: 0,
  }
  try {
    status.value = await window.senseVoice.downloadModel()
    $q.notify({type: 'positive', message: 'SenseVoice 模型已就绪'})
  } catch (error) {
    errorMessage.value = normalizeError(error)
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
    await downloadModel()
    if (!status.value.modelAvailable) return
  }

  isStarting.value = true
  errorMessage.value = ''
  let pendingStream: MediaStream | null = null
  let pendingContext: AudioContext | null = null
  try {
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
    await refreshDevices()

    const context = new AudioContext({latencyHint: 'interactive'})
    pendingContext = context
    await context.audioWorklet.addModule(
      new URL('audio-worklets/sensevoice-pcm.js', window.location.href).toString()
    )
    await context.resume()

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
      if (event.data.samples?.length) {
        audioLevel.value = Math.min(Math.max((event.data.rms ?? 0) * 8, 0), 1)
        window.senseVoice.pushAudio({
          sampleRate: context.sampleRate,
          samples: event.data.samples,
        })
      }
    }

    audioResources = {stream, context, source, processor, sink}
    status.value = await window.senseVoice.start(context.sampleRate)
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
  disposers.push(
    window.senseVoice.onStatus((nextStatus: SenseVoiceStatus) => {
      status.value = nextStatus
    }),
    window.senseVoice.onDownloadProgress((progress: SenseVoiceDownloadProgress) => {
      downloadProgress.value = progress
    }),
    window.senseVoice.onResult(handleResult),
    window.senseVoice.onError((message: string) => {
      errorMessage.value = message
    })
  )

  try {
    status.value = await window.senseVoice.getStatus()
    await refreshDevices()
  } catch (error) {
    errorMessage.value = normalizeError(error)
  }
})

onBeforeUnmount(() => {
  disposers.forEach(dispose => dispose())
  if (isRecording.value) void stopRecording()
  else void releaseAudioResources()
})
</script>

<template>
  <main class="sensevoice-page">
    <header class="page-heading">
      <div>
        <h1>SenseVoice 本地语音识别</h1>
        <div class="engine-line">SenseVoiceSmall int8 · sherpa-onnx · CPU</div>
      </div>
      <q-chip square dense :color="statusColor" text-color="white" :icon="isRecording ? 'graphic_eq' : 'memory'">
        {{ statusLabel }}
      </q-chip>
    </header>

    <section class="model-bar" :class="{'model-bar--missing': !status.modelAvailable}">
      <div class="model-info">
        <div class="model-copy">
          <div class="model-name">SenseVoice 中文多语种 int8</div>
          <div class="model-path" :title="status.modelDirectory">{{ status.modelDirectory }}</div>
        </div>
      </div>
      <q-btn
        v-if="!status.modelAvailable"
        color="primary"
        icon="download"
        label="下载模型"
        no-caps
        unelevated
        :loading="isDownloading"
        @click="downloadModel"
      />
      <q-icon v-else name="check_circle" color="positive" size="22px" />
      <div v-if="isDownloading || downloadProgress" class="download-progress">
        <q-linear-progress
          rounded
          size="7px"
          color="primary"
          :indeterminate="!downloadProgress?.totalBytes"
          :value="downloadProgress?.percent ?? 0"
        />
        <span>{{ progressLabel }}</span>
      </div>
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
            :disable="isDownloading"
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

.download-progress {
  display: grid;
  flex: 1 0 100%;
  gap: 3px;
}

.download-progress span {
  color: var(--app-text-secondary);
  font-size: 11px;
  text-align: right;
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

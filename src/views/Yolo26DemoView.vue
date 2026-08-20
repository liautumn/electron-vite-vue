<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useQuasar} from 'quasar'
import type {ImageFileEntry, ImageSelectionMode} from '../../shared/types/image-files'
import type {
  Yolo26FrameInferenceResult,
  Yolo26InferenceResult,
  Yolo26Status,
  Yolo26StressResult,
} from '../../shared/types/yolo26'
import {useCamera} from '../composables/useCamera'
import {detectionColor, renderYolo26Result} from '../utils/yolo26-result'

defineOptions({name: 'yolo26-demo'})

type QueueState = 'pending' | 'running' | 'done' | 'error'
type SourceMode = 'images' | 'camera'

type PresentedInferenceResult = Yolo26InferenceResult & ImageFileEntry & {
  imageUrl: string
}

type QueueItem = ImageFileEntry & {
  state: QueueState
  error?: string
  result?: PresentedInferenceResult
}

const $q = useQuasar()
const sourceMode = ref<SourceMode>('images')
const confidence = ref(0.25)
const queue = ref<QueueItem[]>([])
const engineStatus = ref<Yolo26Status | null>(null)
const selecting = ref(false)
const running = ref(false)
const downloading = ref(false)
const stressTesting = ref(false)
const gpuSwitching = ref(false)
const gpuEnabled = ref(false)
const stopRequested = ref(false)
const selectedPath = ref<string | null>(null)
const previewResult = ref<PresentedInferenceResult | null>(null)
const stressResult = ref<Yolo26StressResult | null>(null)
const cameraResult = ref<Yolo26FrameInferenceResult | null>(null)
const recognitionError = ref('')
const cameraFps = ref<number | null>(null)
const cameraInferencePending = ref(false)
const cameraOverlayCanvas = ref<HTMLCanvasElement | null>(null)
const {
  state: cameraState,
  devices: cameraDevices,
  selectedDeviceId: selectedCameraId,
  frameSize: cameraFrameSize,
  error: cameraSourceError,
  videoRef: cameraVideo,
  isRunning: cameraIsRunning,
  isStarting: cameraIsStarting,
  refreshDevices: refreshCameraDevices,
  start: startCameraSource,
  stop: stopCameraSource,
  captureFrame: captureCameraFrame,
} = useCamera({maxFrameEdge: 640})
let recognitionGeneration = 0
let nextCameraFrameId = 0
let activeFrameInference: Promise<Yolo26FrameInferenceResult> | null = null
let pendingAnimationFrame: number | null = null
let resolveAnimationFrame: ((active: boolean) => void) | null = null
let pageActive = false
const previewOpen = computed({
  get: () => Boolean(previewResult.value),
  set: (open: boolean) => {
    if (!open) previewResult.value = null
  },
})

const resultItems = computed(() => queue.value.filter(
  (item): item is QueueItem & {result: PresentedInferenceResult} => Boolean(item.result)
))
const selectedItem = computed(() => queue.value.find(item => item.path === selectedPath.value) ?? null)
const selectedResult = computed(() => selectedItem.value?.result ?? null)
const pendingCount = computed(() => queue.value.filter(item => item.state === 'pending').length)
const completedCount = computed(() => queue.value.filter(item => item.state === 'done' || item.state === 'error').length)
const progress = computed(() => queue.value.length ? completedCount.value / queue.value.length : 0)
const cameraIsBusy = computed(() =>
  cameraIsStarting.value
  || cameraInferencePending.value
)
const gpuControlDisabled = computed(() =>
  gpuSwitching.value
  || running.value
  || stressTesting.value
  || cameraIsRunning.value
  || cameraIsBusy.value
  || (!gpuEnabled.value && (
    !engineStatus.value?.modelAvailable
    || !engineStatus.value.gpuAvailable
  ))
)
const providerLabel = computed(() =>
  engineStatus.value?.provider.replace('ExecutionProvider', '') || 'CPU'
)
const gpuTooltip = computed(() => {
  if (engineStatus.value?.gpuAvailable) {
    return `GPU provider：${engineStatus.value.gpuProvider}`
  }
  return '当前系统的 ONNX Runtime 不支持 GPU 推理'
})
const cameraError = computed(() => cameraSourceError.value || recognitionError.value)
const cameraDeviceOptions = computed(() => cameraDevices.value.map((device, index) => ({
  label: device.label || `摄像头 ${index + 1}`,
  value: device.deviceId,
})))
const cameraStageStyle = computed<Record<string, string>>(() => {
  const ratio = cameraFrameSize.value.width / cameraFrameSize.value.height
  return {
    aspectRatio: `${cameraFrameSize.value.width} / ${cameraFrameSize.value.height}`,
    '--camera-ratio': String(ratio),
    '--camera-inverse-ratio': String(1 / ratio),
  }
})
const cameraStateLabel = computed(() => {
  if (cameraState.value === 'starting') return '正在启动'
  if (cameraState.value === 'running') return '实时识别中'
  if (cameraState.value === 'error') return '相机异常'
  return '相机未启动'
})
const cameraStateIcon = computed(() => {
  if (cameraState.value === 'running') return 'videocam'
  if (cameraState.value === 'starting') return 'progress_activity'
  if (cameraState.value === 'error') return 'videocam_off'
  return 'videocam'
})
const cameraStateColor = computed(() => {
  if (cameraState.value === 'running') return 'positive'
  if (cameraState.value === 'error') return 'negative'
  return 'grey-7'
})
const modelName = computed(() => {
  const modelPath = engineStatus.value?.modelPath
  return modelPath?.split(/[\\/]/).pop() || 'YOLO26'
})
const statusLabel = computed(() => {
  switch (engineStatus.value?.state) {
    case 'ready': return '引擎就绪'
    case 'loading': return '正在加载'
    case 'error': return '加载失败'
    case 'missing': return '模型缺失'
    default: return '等待加载'
  }
})
const statusIcon = computed(() => {
  switch (engineStatus.value?.state) {
    case 'ready': return 'check_circle'
    case 'loading': return 'hourglass_top'
    case 'error':
    case 'missing': return 'error'
    default: return 'memory'
  }
})
const statusTone = computed(() => {
  if (engineStatus.value?.state === 'ready') return 'positive'
  if (engineStatus.value?.state === 'error' || engineStatus.value?.state === 'missing') return 'negative'
  return 'primary'
})

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const applyEngineStatus = (status: Yolo26Status) => {
  engineStatus.value = status
  gpuEnabled.value = status.gpuEnabled
}

const refreshStatus = async () => {
  try {
    applyEngineStatus(await window.yolo26.getStatus())
  } catch (error) {
    $q.notify({type: 'negative', message: toErrorMessage(error)})
  }
}

const changeGpuEnabled = async (enabled: boolean) => {
  gpuSwitching.value = true
  try {
    const status = await window.yolo26.setGpuEnabled(enabled)
    if (!pageActive) return
    applyEngineStatus(status)
    stressResult.value = null
    $q.notify({type: 'positive', message: `已切换为 ${providerLabel.value} 推理`})
  } catch (error) {
    if (pageActive) {
      await refreshStatus()
      $q.notify({type: 'negative', message: toErrorMessage(error)})
    }
  } finally {
    gpuSwitching.value = false
  }
}

const selectImages = async (mode: ImageSelectionMode) => {
  selecting.value = true
  try {
    const files = await window.imageFiles.select(mode)
    const existingPaths = new Set(queue.value.map(item => item.path))
    const additions = files
      .filter(file => !existingPaths.has(file.path))
      .map<QueueItem>(file => ({...file, state: 'pending'}))
    queue.value.push(...additions)
    if (!selectedPath.value && additions.length) selectedPath.value = additions[0].path
    if (files.length && !additions.length) {
      $q.notify({type: 'info', message: '所选图片已在队列中'})
    }
  } catch (error) {
    $q.notify({type: 'negative', message: toErrorMessage(error)})
  } finally {
    selecting.value = false
  }
}

const runQueue = async (rerun = false) => {
  if (rerun) {
    queue.value.forEach(item => {
      item.state = 'pending'
      item.error = undefined
      item.result = undefined
    })
  }
  if (!pendingCount.value) return

  running.value = true
  stopRequested.value = false
  for (const item of queue.value) {
    if (stopRequested.value || item.state !== 'pending') continue
    item.state = 'running'
    item.error = undefined
    try {
      const imageFile = await window.imageFiles.read(item.path)
      const inference = await window.yolo26.inferImage({
        image: {bytes: imageFile.encoded},
        confidence: confidence.value,
      })
      item.result = {
        ...inference,
        path: item.path,
        name: item.name,
        imageUrl: await renderYolo26Result(imageFile.previewUrl, inference),
      }
      item.state = 'done'
    } catch (error) {
      item.state = 'error'
      item.error = toErrorMessage(error)
    }
  }
  running.value = false
  await refreshStatus()
}

const requestStop = () => {
  stopRequested.value = true
}

const retryItem = async (item: QueueItem) => {
  item.state = 'pending'
  item.error = undefined
  item.result = undefined
  await runQueue()
}

const removeItem = (item: QueueItem) => {
  const index = queue.value.findIndex(candidate => candidate.path === item.path)
  queue.value.splice(index, 1)
  if (selectedPath.value === item.path) {
    selectedPath.value = queue.value[Math.min(index, queue.value.length - 1)]?.path ?? null
  }
}

const clearQueue = () => {
  queue.value = []
  selectedPath.value = null
  previewResult.value = null
  stressResult.value = null
}

const downloadSelectedResult = async () => {
  if (!selectedResult.value) return
  downloading.value = true
  try {
    const sourceName = selectedResult.value.name.replace(/\.[^.]+$/, '')
    const downloadPath = await window.imageFiles.saveJpeg({
      name: `${sourceName}-result.jpg`,
      imageUrl: selectedResult.value.imageUrl,
    })
    if (downloadPath) $q.notify({type: 'positive', message: `已下载：${downloadPath}`})
  } catch (error) {
    $q.notify({type: 'negative', message: toErrorMessage(error)})
  } finally {
    downloading.value = false
  }
}

const runStressTest = async () => {
  stressTesting.value = true
  try {
    stressResult.value = await window.yolo26.stressTest()
  } catch (error) {
    $q.notify({type: 'negative', message: toErrorMessage(error)})
  } finally {
    stressTesting.value = false
  }
}

const clearCameraOverlay = () => {
  const canvas = cameraOverlayCanvas.value
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
}

const drawCameraDetections = (result: Yolo26FrameInferenceResult) => {
  const canvas = cameraOverlayCanvas.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return

  canvas.width = result.width
  canvas.height = result.height
  context.clearRect(0, 0, result.width, result.height)
  const lineWidth = Math.max(2, Math.round(Math.min(result.width, result.height) / 320))
  const fontSize = Math.max(12, Math.round(Math.min(result.width, result.height) / 35))
  const labelHeight = fontSize + 8
  context.font = `600 ${fontSize}px Arial, sans-serif`
  context.textBaseline = 'middle'

  result.detections.forEach(detection => {
    const [x1, y1, x2, y2] = detection.box
    const color = detectionColor(detection)
    const label = `${detection.className} ${(detection.confidence * 100).toFixed(0)}%`
    const labelWidth = Math.min(result.width - x1, context.measureText(label).width + 12)
    const labelY = Math.max(0, y1 - labelHeight)
    context.strokeStyle = color
    context.lineWidth = lineWidth
    context.strokeRect(x1, y1, x2 - x1, y2 - y1)
    context.fillStyle = color
    context.fillRect(x1, labelY, labelWidth, labelHeight)
    context.fillStyle = '#ffffff'
    context.fillText(label, x1 + 6, labelY + labelHeight / 2)
  })
}

const nextVideoFrame = () => new Promise<boolean>(resolve => {
  resolveAnimationFrame = resolve
  pendingAnimationFrame = requestAnimationFrame(() => {
    pendingAnimationFrame = null
    resolveAnimationFrame = null
    resolve(true)
  })
})

const cancelNextVideoFrame = () => {
  if (pendingAnimationFrame !== null) cancelAnimationFrame(pendingAnimationFrame)
  pendingAnimationFrame = null
  const resolve = resolveAnimationFrame
  resolveAnimationFrame = null
  resolve?.(false)
}

const runCameraInference = async (generation: number) => {
  while (generation === recognitionGeneration && cameraState.value === 'running') {
    if (!await nextVideoFrame()) return
    if (generation !== recognitionGeneration || cameraState.value !== 'running') return
    const frame = captureCameraFrame()
    if (!frame) continue

    const loopStartedAt = performance.now()
    const frameId = nextCameraFrameId
    nextCameraFrameId += 1
    cameraInferencePending.value = true
    const inference = window.yolo26.inferFrame({
      frameId,
      frame,
      confidence: confidence.value,
    })
    activeFrameInference = inference
    try {
      const result = await inference
      if (generation !== recognitionGeneration || cameraState.value !== 'running') return
      cameraResult.value = result
      cameraFps.value = 1000 / Math.max(performance.now() - loopStartedAt, 1)
      drawCameraDetections(result)
    } catch (error) {
      if (generation === recognitionGeneration) {
        recognitionError.value = toErrorMessage(error)
        recognitionGeneration += 1
        cancelNextVideoFrame()
        stopCameraSource()
        clearCameraOverlay()
      }
      return
    } finally {
      if (activeFrameInference === inference) {
        activeFrameInference = null
        cameraInferencePending.value = false
      }
    }
  }
}

const stopCamera = () => {
  recognitionGeneration += 1
  cancelNextVideoFrame()
  stopCameraSource()
  cameraResult.value = null
  cameraFps.value = null
  recognitionError.value = ''
  clearCameraOverlay()
  if (!activeFrameInference) cameraInferencePending.value = false
}

const startCamera = async () => {
  if (cameraIsStarting.value || cameraIsRunning.value || activeFrameInference
    || running.value || stressTesting.value) return

  cancelNextVideoFrame()
  const generation = ++recognitionGeneration
  recognitionError.value = ''
  cameraResult.value = null
  cameraFps.value = null
  clearCameraOverlay()

  const started = await startCameraSource()
  if (!started || generation !== recognitionGeneration || sourceMode.value !== 'camera') return
  void runCameraInference(generation)
}

const stateIcon = (state: QueueState) => ({
  pending: 'schedule',
  running: 'progress_activity',
  done: 'check_circle',
  error: 'error',
})[state]

const stateColor = (state: QueueState) => ({
  pending: 'grey-6',
  running: 'primary',
  done: 'positive',
  error: 'negative',
})[state]

const handleCameraDeviceChange = () => {
  void refreshCameraDevices().catch(() => undefined)
}

watch(sourceMode, mode => {
  if (mode === 'camera') {
    handleCameraDeviceChange()
  } else if (cameraState.value !== 'idle' || activeFrameInference) {
    stopCamera()
  }
})

watch(cameraState, (state, previousState) => {
  if (state !== 'error' || (previousState !== 'running' && previousState !== 'starting')) return
  recognitionGeneration += 1
  cancelNextVideoFrame()
  cameraResult.value = null
  cameraFps.value = null
  clearCameraOverlay()
  if (!activeFrameInference) cameraInferencePending.value = false
})

onMounted(async () => {
  pageActive = true
  try {
    const status = await window.yolo26.initialize()
    if (pageActive) applyEngineStatus(status)
  } catch (error) {
    if (pageActive) $q.notify({type: 'negative', message: toErrorMessage(error)})
  }
})

onBeforeUnmount(() => {
  pageActive = false
  requestStop()
  stopCamera()
  void window.yolo26.dispose().catch(error => {
    console.error('Failed to dispose YOLO26', error)
  })
})
</script>

<template>
  <main class="yolo-page">
    <header class="page-heading">
      <div>
        <h1>YOLO26 ONNX 测试</h1>
        <p>ONNX Runtime Node · OpenCV.js · YOLO26 · {{ providerLabel }}</p>
      </div>
      <q-btn flat round dense icon="refresh" aria-label="刷新模型状态" @click="refreshStatus">
        <q-tooltip>刷新模型状态</q-tooltip>
      </q-btn>
    </header>

    <section
      class="model-bar"
      :class="{'model-bar--error': engineStatus?.state === 'error' || engineStatus?.state === 'missing'}"
    >
      <q-icon :name="statusIcon" :color="statusTone" size="22px" />
      <div class="model-copy">
        <div class="model-summary">
          <strong>{{ modelName }}</strong>
          <span>{{ statusLabel }}</span>
          <span>{{ engineStatus?.inputSize ?? 640 }} × {{ engineStatus?.inputSize ?? 640 }}</span>
          <span>{{ engineStatus?.classCount ?? 0 }} 类</span>
          <span>{{ providerLabel }} 推理</span>
        </div>
        <div class="model-path" :title="engineStatus?.modelPath">{{ engineStatus?.modelPath || '—' }}</div>
        <div v-if="engineStatus?.message" class="model-message">{{ engineStatus.message }}</div>
      </div>
      <q-toggle
        :model-value="gpuEnabled"
        class="gpu-toggle"
        color="secondary"
        checked-icon="bolt"
        unchecked-icon="memory"
        label="GPU 推理"
        left-label
        :disable="gpuControlDisabled"
        :loading="gpuSwitching"
        @update:model-value="changeGpuEnabled"
      >
        <q-tooltip>{{ gpuTooltip }}</q-tooltip>
      </q-toggle>
    </section>

    <section class="control-bar">
      <q-btn-toggle
        v-model="sourceMode"
        class="source-toggle"
        no-caps
        unelevated
        toggle-color="primary"
        color="grey-3"
        text-color="grey-8"
        :disable="running || stressTesting || cameraIsRunning || cameraIsBusy"
        :options="[
          {label: '图片', value: 'images', icon: 'image'},
          {label: '相机', value: 'camera', icon: 'videocam'},
        ]"
      />

      <div v-if="sourceMode === 'images'" class="file-actions">
        <q-btn
          color="primary"
          unelevated
          no-caps
          icon="add_photo_alternate"
          label="添加图片"
          :loading="selecting"
          :disable="running || stressTesting"
          @click="selectImages('images')"
        />
        <q-btn
          outline
          color="primary"
          no-caps
          icon="folder_open"
          label="添加目录"
          :disable="selecting || running || stressTesting"
          @click="selectImages('directory')"
        />
      </div>

      <div v-else class="camera-actions">
        <q-select
          v-model="selectedCameraId"
          class="camera-select"
          dense
          outlined
          emit-value
          map-options
          options-dense
          label="摄像头"
          :options="cameraDeviceOptions"
          :disable="cameraIsRunning || cameraIsBusy"
        />
        <q-btn
          flat
          round
          dense
          icon="refresh"
          aria-label="刷新摄像头列表"
          :disable="cameraIsRunning || cameraIsBusy"
          @click="handleCameraDeviceChange"
        >
          <q-tooltip>刷新摄像头列表</q-tooltip>
        </q-btn>
        <q-btn
          v-if="!cameraIsRunning && !cameraIsStarting"
          color="positive"
          unelevated
          no-caps
          icon="play_arrow"
          label="开始识别"
          :loading="cameraState === 'starting'"
          :disable="running || stressTesting || gpuSwitching || cameraInferencePending || !engineStatus?.modelAvailable"
          @click="startCamera"
        />
        <q-btn
          v-else
          color="negative"
          unelevated
          no-caps
          icon="stop"
          :label="cameraIsStarting ? '停止启动' : '停止识别'"
          @click="stopCamera"
        />
      </div>

      <div class="confidence-control">
        <span>置信度</span>
        <q-slider v-model="confidence" :min="0.05" :max="0.95" :step="0.05" color="primary" />
        <strong>{{ confidence.toFixed(2) }}</strong>
      </div>

      <div v-if="sourceMode === 'images'" class="run-actions">
        <q-btn
          v-if="!running"
          color="positive"
          unelevated
          no-caps
          icon="play_arrow"
          label="开始推理"
          :disable="stressTesting || gpuSwitching || !pendingCount || !engineStatus?.modelAvailable"
          @click="runQueue()"
        />
        <q-btn
          v-if="!running"
          outline
          color="secondary"
          no-caps
          icon="speed"
          label="压力测试"
          :loading="stressTesting"
          :disable="gpuSwitching || !engineStatus?.engineReady"
          @click="runStressTest"
        />
        <q-btn
          v-if="running"
          color="negative"
          unelevated
          no-caps
          icon="stop"
          label="停止队列"
          :disable="stopRequested"
          @click="requestStop"
        />
        <q-btn
          flat
          round
          dense
          icon="restart_alt"
          aria-label="重新推理全部图片"
          :disable="running || stressTesting || !resultItems.length"
          @click="runQueue(true)"
        >
          <q-tooltip>重新推理全部图片</q-tooltip>
        </q-btn>
        <q-btn
          flat
          round
          dense
          icon="delete_sweep"
          aria-label="清空队列"
          :disable="running || stressTesting || !queue.length"
          @click="clearQueue"
        >
          <q-tooltip>清空队列</q-tooltip>
        </q-btn>
      </div>
      <q-linear-progress
        v-if="sourceMode === 'images' && (running || completedCount)"
        class="queue-progress"
        :value="progress"
        color="positive"
        track-color="grey-4"
        rounded
        size="4px"
      />
    </section>

    <section v-if="sourceMode === 'images' && stressResult" class="stress-summary">
      <div class="stress-heading">
        <q-icon name="speed" color="secondary" size="22px" />
        <div>
          <strong>压力测试结果</strong>
          <span>
            {{ stressResult.name }} · {{ stressResult.inputWidth }} × {{ stressResult.inputHeight }} ·
            预热 {{ stressResult.warmupRuns }} 次 / 计时 {{ stressResult.iterations }} 次
          </span>
        </div>
      </div>
      <dl class="stress-metrics">
        <div>
          <dt>平均预处理</dt>
          <dd>{{ stressResult.preprocessMs.toFixed(2) }} ms</dd>
        </div>
        <div>
          <dt>平均推理</dt>
          <dd>{{ stressResult.inferenceMs.toFixed(2) }} ms</dd>
        </div>
        <div>
          <dt>平均总耗时</dt>
          <dd>{{ stressResult.totalMs.toFixed(2) }} ms</dd>
        </div>
        <div>
          <dt>吞吐率</dt>
          <dd>{{ stressResult.fps.toFixed(2) }} FPS</dd>
        </div>
      </dl>
    </section>

    <div v-if="sourceMode === 'images'" class="workspace-grid">
      <section class="queue-pane">
        <div class="section-heading">
          <h2>图片队列</h2>
          <span>{{ queue.length }} 张</span>
        </div>

        <div v-if="!queue.length" class="empty-state empty-state--queue">
          <q-icon name="collections" size="34px" />
          <span>尚未添加图片</span>
        </div>

        <q-list v-else separator class="queue-list">
          <q-item
            v-for="item in queue"
            :key="item.path"
            dense
            clickable
            class="queue-item"
            :active="selectedPath === item.path"
            active-class="queue-item--active"
            @click="selectedPath = item.path"
          >
            <q-item-section avatar>
              <q-icon
                :name="stateIcon(item.state)"
                :color="stateColor(item.state)"
                :class="{'status-spin': item.state === 'running'}"
                size="20px"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label class="file-name">{{ item.name }}</q-item-label>
              <q-item-label caption class="file-path" :title="item.path">{{ item.path }}</q-item-label>
              <q-item-label v-if="item.error" caption class="file-error" :title="item.error">
                {{ item.error }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                v-if="item.state === 'error'"
                flat
                round
                dense
                icon="replay"
                aria-label="重试"
                :disable="running"
                @click.stop="retryItem(item)"
              >
                <q-tooltip>重试</q-tooltip>
              </q-btn>
              <q-btn
                v-else
                flat
                round
                dense
                icon="close"
                aria-label="移除"
                :disable="running"
                @click.stop="removeItem(item)"
              >
                <q-tooltip>移除</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </q-list>
      </section>

      <section class="result-pane">
        <div class="section-heading">
          <h2>推理结果</h2>
          <div class="result-heading-actions">
            <span>{{ resultItems.length }} / {{ queue.length }}</span>
            <q-btn
              flat
              dense
              no-caps
              color="primary"
              icon="download"
              label="下载图片"
              :loading="downloading"
              :disable="!selectedResult"
              @click="downloadSelectedResult"
            />
          </div>
        </div>

        <div v-if="!selectedResult" class="empty-state">
          <q-icon name="image_search" size="42px" />
          <span>{{ selectedItem?.state === 'running' ? '正在生成结果' : '暂无推理结果' }}</span>
        </div>

        <div v-else class="selected-result">
          <button class="result-image-button" type="button" @click="previewResult = selectedResult">
            <img :src="selectedResult.imageUrl" :alt="`${selectedResult.name} 推理结果`" />
            <span class="preview-icon"><q-icon name="zoom_in" size="20px" /></span>
          </button>
          <div class="result-meta">
            <div class="result-name" :title="selectedResult.name">{{ selectedResult.name }}</div>
            <div class="result-stats">
              <span>{{ selectedResult.detections.length }} 个目标</span>
              <span>{{ selectedResult.inferenceMs.toFixed(1) }} ms</span>
              <span>{{ selectedResult.width }} × {{ selectedResult.height }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section v-else class="camera-workspace">
      <div class="section-heading camera-heading">
        <h2>实时识别</h2>
        <div class="camera-status">
          <q-icon
            :name="cameraStateIcon"
            :color="cameraStateColor"
            :class="{'status-spin': cameraState === 'starting'}"
            size="18px"
          />
          <span>{{ cameraStateLabel }}</span>
        </div>
      </div>

      <div v-if="cameraError" class="camera-error">
        <q-icon name="error" size="18px" />
        <span>{{ cameraError }}</span>
      </div>

      <div class="camera-layout">
        <div class="camera-preview-pane">
          <div class="camera-stage" :style="cameraStageStyle">
            <video
              ref="cameraVideo"
              autoplay
              muted
              playsinline
              :class="{'camera-video--active': cameraIsRunning || cameraState === 'starting'}"
            />
            <canvas ref="cameraOverlayCanvas" class="camera-overlay" />
            <div v-if="!cameraIsRunning && cameraState !== 'starting'" class="camera-placeholder">
              <q-icon name="videocam" size="44px" />
              <span>相机未启动</span>
            </div>
            <q-spinner
              v-if="cameraInferencePending"
              class="camera-spinner"
              color="white"
              size="24px"
            />
          </div>
        </div>

        <aside class="camera-inspector">
          <dl class="camera-metrics">
            <div>
              <dt>目标</dt>
              <dd>{{ cameraResult?.detections.length ?? 0 }}</dd>
            </div>
            <div>
              <dt>预处理</dt>
              <dd>{{ cameraResult ? `${cameraResult.preprocessMs.toFixed(1)} ms` : '—' }}</dd>
            </div>
            <div>
              <dt>推理</dt>
              <dd>{{ cameraResult ? `${cameraResult.inferenceMs.toFixed(1)} ms` : '—' }}</dd>
            </div>
            <div>
              <dt>实时速率</dt>
              <dd>{{ cameraFps ? `${cameraFps.toFixed(1)} FPS` : '—' }}</dd>
            </div>
          </dl>

          <div class="camera-detections-heading">检测目标</div>
          <div v-if="!cameraResult?.detections.length" class="camera-detections-empty">暂无目标</div>
          <q-list v-else separator dense class="camera-detections">
            <q-item v-for="(detection, index) in cameraResult.detections" :key="`${detection.classId}-${index}`">
              <q-item-section avatar>
                <span class="detection-swatch" :style="{backgroundColor: detectionColor(detection)}" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ detection.className }}</q-item-label>
                <q-item-label caption>
                  {{ (detection.confidence * 100).toFixed(1) }}%
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </aside>
      </div>
    </section>

    <q-dialog v-model="previewOpen" maximized transition-show="fade" transition-hide="fade">
      <div class="preview-dialog">
        <div class="preview-toolbar">
          <div>
            <strong>{{ previewResult?.name }}</strong>
            <span>{{ previewResult?.detections.length ?? 0 }} 个目标</span>
          </div>
          <q-btn v-close-popup flat round icon="close" aria-label="关闭预览" />
        </div>
        <img v-if="previewResult" :src="previewResult.imageUrl" :alt="`${previewResult.name} 推理结果预览`" />
      </div>
    </q-dialog>
  </main>
</template>

<style scoped>
.yolo-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: calc(100dvh - 128px);
}

.page-heading,
.model-bar,
.control-bar,
.section-heading,
.file-actions,
.camera-actions,
.camera-status,
.confidence-control,
.run-actions,
.model-summary,
.result-stats,
.preview-toolbar {
  align-items: center;
  display: flex;
}

.stress-summary {
  align-items: center;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--q-secondary);
  border-radius: 6px;
  display: flex;
  gap: 18px;
  justify-content: space-between;
  padding: 10px 12px;
}

.stress-heading {
  align-items: center;
  display: flex;
  gap: 9px;
  min-width: 210px;
}

.stress-heading > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stress-heading strong {
  font-size: 13px;
}

.stress-heading span,
.stress-metrics dt,
.stress-metrics small {
  color: var(--app-text-secondary);
  font-size: 10px;
}

.stress-heading span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stress-metrics {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(5, minmax(90px, 1fr));
  margin: 0;
}

.stress-metrics > div {
  min-width: 0;
  padding: 0 10px;
}

.stress-metrics > div + div {
  border-left: 1px solid var(--app-border);
}

.stress-metrics dd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 650;
  margin: 2px 0 0;
}

.stress-metrics small {
  display: block;
  margin-top: 1px;
}

.result-heading-actions {
  align-items: center;
  display: flex;
  gap: 8px;
}

.page-heading {
  justify-content: space-between;
  min-height: 44px;
}

h1,
h2,
.page-heading p {
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

.page-heading p,
.section-heading span,
.model-summary span,
.model-path,
.result-stats {
  color: var(--app-text-secondary);
}

.page-heading p {
  font-size: 12px;
  margin-top: 1px;
}

.model-bar {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--q-primary);
  border-radius: 6px;
  gap: 10px;
  min-height: 58px;
  padding: 8px 12px;
}

.model-bar--error {
  border-left-color: var(--q-negative);
}

.model-copy {
  min-width: 0;
  width: 100%;
}

.gpu-toggle {
  flex: 0 0 auto;
  min-width: 118px;
}

.model-summary {
  flex-wrap: wrap;
  gap: 6px 12px;
}

.model-summary strong {
  font-size: 14px;
}

.model-summary span {
  font-size: 12px;
}

.model-path,
.model-message {
  font-size: 11px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.model-message,
.file-error {
  color: var(--q-negative) !important;
}

.control-bar {
  border-bottom: 1px solid var(--app-border);
  flex-wrap: wrap;
  gap: 10px 18px;
  min-height: 56px;
  padding: 4px 0 10px;
  position: relative;
}

.file-actions,
.run-actions,
.camera-actions {
  gap: 8px;
}

.source-toggle {
  flex: 0 0 auto;
}

.camera-actions {
  flex: 0 1 auto;
}

.camera-select {
  min-width: 210px;
  width: 240px;
}

.confidence-control {
  flex: 1 1 260px;
  gap: 10px;
  min-width: 230px;
}

.confidence-control span {
  color: var(--app-text-secondary);
  flex: 0 0 auto;
  font-size: 12px;
}

.confidence-control strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  min-width: 32px;
}

.queue-progress {
  bottom: -2px;
  left: 0;
  position: absolute;
  right: 0;
}

.workspace-grid {
  display: grid;
  flex: 1 1 420px;
  gap: 10px;
  grid-template-columns: minmax(260px, 310px) minmax(0, 1fr);
  min-height: 420px;
}

.camera-workspace {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 6px;
  display: flex;
  flex: 1 1 480px;
  flex-direction: column;
  min-height: 480px;
  overflow: hidden;
}

.camera-heading {
  flex: 0 0 auto;
}

.camera-status {
  gap: 6px;
}

.camera-error {
  align-items: center;
  background: color-mix(in srgb, var(--q-negative) 8%, var(--app-surface));
  border-bottom: 1px solid color-mix(in srgb, var(--q-negative) 28%, var(--app-border));
  color: var(--q-negative);
  display: flex;
  font-size: 12px;
  gap: 7px;
  padding: 8px 12px;
}

.camera-layout {
  display: grid;
  flex: 1;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) 260px;
  min-height: 0;
  padding: 10px;
}

.camera-stage {
  background: #111318;
  border-radius: 4px;
  height: min(100cqh, calc(100cqw * var(--camera-inverse-ratio)));
  overflow: hidden;
  position: relative;
  width: min(100cqw, calc(100cqh * var(--camera-ratio)));
}

.camera-preview-pane {
  container-type: size;
  display: grid;
  min-height: 280px;
  min-width: 0;
  place-items: center;
}

.camera-stage video,
.camera-overlay {
  height: 100%;
  inset: 0;
  position: absolute;
  width: 100%;
}

.camera-stage video {
  object-fit: fill;
  opacity: 0;
}

.camera-stage .camera-video--active {
  opacity: 1;
}

.camera-overlay {
  pointer-events: none;
}

.camera-placeholder {
  align-items: center;
  color: #9ca3af;
  display: flex;
  flex-direction: column;
  font-size: 13px;
  gap: 8px;
  inset: 0;
  justify-content: center;
  position: absolute;
}

.camera-spinner {
  position: absolute;
  right: 12px;
  top: 12px;
}

.camera-inspector {
  border-left: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding-left: 10px;
}

.camera-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.camera-metrics > div {
  border-bottom: 1px solid var(--app-border);
  min-width: 0;
  padding: 9px 8px;
}

.camera-metrics > div:nth-child(even) {
  border-left: 1px solid var(--app-border);
}

.camera-metrics dt,
.camera-detections-empty {
  color: var(--app-text-secondary);
  font-size: 11px;
}

.camera-metrics dd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 650;
  margin: 3px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.camera-detections-heading {
  font-size: 12px;
  font-weight: 650;
  padding: 12px 8px 8px;
}

.camera-detections-empty {
  align-items: center;
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 120px;
}

.camera-detections {
  flex: 1;
  overflow: auto;
}

.camera-detections :deep(.q-item) {
  min-height: 50px;
  padding: 6px 8px;
}

.camera-detections :deep(.q-item__section--avatar) {
  min-width: 28px;
}

.detection-swatch {
  border-radius: 2px;
  display: block;
  height: 12px;
  width: 12px;
}

.queue-pane,
.result-pane {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.section-heading {
  border-bottom: 1px solid var(--app-border);
  justify-content: space-between;
  min-height: 46px;
  padding: 0 14px;
}

.section-heading span {
  font-size: 12px;
}

.queue-list,
.selected-result {
  overflow: auto;
}

.queue-list {
  flex: 1;
}

.queue-item {
  min-height: 62px;
  padding: 7px 8px 7px 12px;
}

.queue-item--active {
  background: color-mix(in srgb, var(--q-primary) 12%, var(--app-surface));
  box-shadow: inset 3px 0 var(--q-primary);
}

.queue-item :deep(.q-item__section--avatar) {
  min-width: 32px;
}

.file-name {
  font-size: 13px;
  font-weight: 600;
}

.file-path,
.file-error {
  max-width: 205px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

.file-error {
  font-size: 10px;
}

.status-spin {
  animation: status-spin 900ms linear infinite;
}

.empty-state {
  align-items: center;
  color: var(--app-text-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  font-size: 13px;
  gap: 8px;
  justify-content: center;
  min-height: 220px;
}

.empty-state--queue {
  min-height: 160px;
}

.selected-result {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 10px;
}

.result-image-button {
  background: color-mix(in srgb, var(--app-border) 35%, var(--app-surface));
  border: 1px solid var(--app-border);
  border-radius: 6px 6px 0 0;
  cursor: zoom-in;
  display: flex;
  flex: 1;
  min-height: 280px;
  overflow: hidden;
  padding: 0;
  position: relative;
  width: 100%;
}

.result-image-button img {
  display: block;
  height: 100%;
  object-fit: contain;
  width: 100%;
}

.preview-icon {
  align-items: center;
  background: rgba(20, 24, 31, 0.74);
  border-radius: 4px;
  bottom: 8px;
  color: #fff;
  display: flex;
  height: 30px;
  justify-content: center;
  opacity: 0;
  position: absolute;
  right: 8px;
  transition: opacity 160ms ease;
  width: 30px;
}

.result-image-button:hover .preview-icon,
.result-image-button:focus-visible .preview-icon {
  opacity: 1;
}

.result-meta {
  border: 1px solid var(--app-border);
  border-radius: 0 0 6px 6px;
  border-top: 0;
  padding: 9px 10px 10px;
}

.result-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-stats {
  flex-wrap: wrap;
  font-size: 11px;
  gap: 3px 10px;
  margin-top: 4px;
}

.preview-dialog {
  background: #111318;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.preview-toolbar {
  color: #fff;
  justify-content: space-between;
  min-height: 58px;
  padding: 6px 14px 6px 18px;
}

.preview-toolbar div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.preview-toolbar strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-toolbar span {
  color: #aeb4bf;
  font-size: 11px;
}

.preview-dialog > img {
  flex: 1;
  min-height: 0;
  object-fit: contain;
  width: 100%;
}

@keyframes status-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .stress-summary {
    align-items: stretch;
    flex-direction: column;
  }

  .stress-metrics {
    grid-template-columns: repeat(3, minmax(90px, 1fr));
  }

  .stress-metrics > div:nth-child(4) {
    border-left: 0;
  }

  .workspace-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .camera-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .camera-inspector {
    border-left: 0;
    border-top: 1px solid var(--app-border);
    max-height: 300px;
    padding-left: 0;
    padding-top: 10px;
  }

  .queue-pane {
    max-height: 280px;
  }
}

@media (max-width: 620px) {
  .control-bar,
  .file-actions,
  .camera-actions,
  .run-actions {
    align-items: stretch;
  }

  .file-actions,
  .camera-actions,
  .run-actions {
    flex-wrap: wrap;
    width: 100%;
  }

  .source-toggle,
  .camera-select {
    width: 100%;
  }

  .camera-preview-pane {
    min-height: 220px;
  }

  .stress-metrics {
    grid-template-columns: repeat(2, minmax(90px, 1fr));
  }

  .stress-metrics > div:nth-child(odd) {
    border-left: 0;
  }

}
</style>

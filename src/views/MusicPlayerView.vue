<script setup lang="ts">
import {
  FolderOpenOutlined, PauseCircleOutlined, PlayCircleOutlined, RedoOutlined,
  RetweetOutlined, StepBackwardOutlined, StepForwardOutlined, SwapOutlined,
} from '@ant-design/icons-vue'
import {message} from 'ant-design-vue'
import {storeToRefs} from 'pinia'
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {type PlayMode, useMusicStore} from '../stores/music'
import type {MusicDirectoryEntry} from '../types/music'

defineOptions({name: 'music-player'})

type LyricLine = { time: number; text: string }

type Track = {
  path: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string
  sourceUrl: string
  lyrics: string
  lyricLines: LyricLine[]
  plainLyricLines: string[]
  metadataLoaded: boolean
  decodeFailed: boolean
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac', '.webm'])
const MAX_TRACK_COUNT = 1000

const musicStore = useMusicStore()
const {musicDirectory, playMode} = storeToRefs(musicStore)

const audioRef = ref<HTMLAudioElement | null>(null)
const lyricPanelRef = ref<HTMLDivElement | null>(null)
const tracks = ref<Track[]>([])
const currentIndex = ref<number>(0)
const currentTime = ref<number>(0)
const isPlaying = ref<boolean>(false)
const loading = ref<boolean>(false)
const autoSkipping = ref<boolean>(false)

const currentTrack = computed(() => tracks.value[currentIndex.value] ?? null)
const hasTrack = computed(() => tracks.value.length > 0)
const currentLyricLines = computed(() => currentTrack.value?.lyricLines ?? [])
const currentPlainLyricLines = computed(() => currentTrack.value?.plainLyricLines ?? [])

const playModeIcon = computed(() => {
  if (playMode.value === 'random') return SwapOutlined
  if (playMode.value === 'loop') return RetweetOutlined
  return RedoOutlined
})

const playModeText = computed(() => {
  const labels: Record<PlayMode, string> = {sequence: '顺序播放', random: '随机播放', loop: '循环播放'}
  return labels[playMode.value]
})

const formatDuration = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${Math.floor(sec % 60).toString().padStart(2, '0')}`
}

const activeLyricIndex = computed(() => {
  const lines = currentLyricLines.value
  for (let i = lines.length - 1; i >= 0; i--) {
    if (currentTime.value >= lines[i].time) return i
  }
  return -1
})

const onSeek = (val: number) => {
  if (audioRef.value) audioRef.value.currentTime = val
}

const getMusicApi = () => {
  if (typeof window === 'undefined' || !('music' in window)) throw new Error('请在 Electron 中运行')
  return window.music
}

const parseLyricLines = (text: string): LyricLine[] => {
  const lines: LyricLine[] = []
  for (const row of text.split(/\r?\n/)) {
    const tokens = [...row.matchAll(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g)]
    const content = row.replace(/\[[^\]]+]/g, '').trim()
    if (!content || !tokens.length) continue
    tokens.forEach(m => {
      lines.push({
        time: Number(m[1]) * 60 + Number(m[2]) + Number((m[3] || '0').padEnd(3, '0').slice(0, 3)) / 1000,
        text: content
      })
    })
  }
  return lines.sort((a, b) => a.time - b.time)
}

const loadTrackInfo = async (index: number) => {
  const track = tracks.value[index]
  if (!track || track.metadataLoaded) return
  try {
    const api = getMusicApi()
    const metadata = await api.readMetadata(track.path)

    track.title = metadata.common.title || track.path.split(/[\\/]/).pop()?.replace(/\.[^./\\]+$/, '') || '未知'
    track.artist = metadata.common.artist || '未知歌手'
    track.album = metadata.common.album || '未知专辑'
    track.duration = metadata.format.duration ?? 0
    track.coverUrl = metadata.common.coverDataUrl || ''

    let lyrics = metadata.common.lyrics || ''
    if (!lyrics) {
      try {
        lyrics = (await api.readTextFile(track.path.replace(/\.[^./\\]+$/, '.lrc'))).trim()
      } catch {
      }
    }

    // 聚合了原本独立的拉取网络封面逻辑
    if (!track.coverUrl) {
      try {
        const query = encodeURIComponent(`${track.artist} ${track.title}`.trim())
        const res = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`)
        track.coverUrl = (await res.json()).results?.[0]?.artworkUrl100?.replace('100x100bb', '512x512bb') || ''
      } catch {
      }
    }

    // 聚合了原本独立的拉取网络歌词逻辑
    if (!lyrics && track.artist !== '未知歌手') {
      try {
        const res = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(track.artist)}&track_name=${encodeURIComponent(track.title)}`)
        const data = await res.json()
        lyrics = data.syncedLyrics || data.plainLyrics || ''
      } catch {
      }
    }

    track.lyrics = lyrics
    track.lyricLines = parseLyricLines(lyrics)
    track.plainLyricLines = lyrics.split(/\r?\n/).map(l => l.replace(/\[[^\]]+]/g, '').trim()).filter(Boolean)
    track.metadataLoaded = true
  } catch (e) {
    console.warn('Load info failed', e)
  }
}

const switchTrack = async (index: number, autoPlay: boolean) => {
  const audio = audioRef.value
  const track = tracks.value[index]
  if (!audio || !track) return

  try {
    track.sourceUrl ||= await getMusicApi().toFileUrl(track.path)
  } catch (e) {
    return message.error(`加载资源失败: ${e}`)
  }

  currentIndex.value = index
  currentTime.value = 0
  audio.src = track.sourceUrl
  audio.load()

  if (autoPlay) audio.play().catch(e => message.warning(`播放失败: ${e}`))
  else audio.pause()

  void loadTrackInfo(index)
}

const getNextIndex = (step: number) => {
  const len = tracks.value.length
  if (playMode.value === 'random') {
    const cands = tracks.value.map((t, i) => t.decodeFailed ? -1 : i).filter(i => i >= 0 && i !== currentIndex.value)
    return cands.length ? cands[Math.floor(Math.random() * cands.length)] : currentIndex.value
  }
  for (let i = 1; i <= len; i++) {
    const idx = (currentIndex.value + step * i + len) % len
    if (!tracks.value[idx].decodeFailed) return idx
  }
  return -1
}

const playNext = () => hasTrack.value && switchTrack(getNextIndex(1), true)
const playPrevious = () => hasTrack.value && switchTrack(getNextIndex(-1), true)

const togglePlayPause = () => {
  if (!audioRef.value || !currentTrack.value) return
  isPlaying.value ? audioRef.value.pause() : audioRef.value.play().catch(e => message.warning(`播放失败: ${e}`))
}

const togglePlayMode = () => {
  const order: PlayMode[] = ['sequence', 'random', 'loop']
  musicStore.setPlayMode(order[(order.indexOf(playMode.value) + 1) % order.length])
}

const onTrackEnded = () => {
  if (!hasTrack.value) return
  if (playMode.value === 'loop') return switchTrack(currentIndex.value, true)
  if (playMode.value === 'sequence' && currentIndex.value + 1 >= tracks.value.length) {
    if (audioRef.value) audioRef.value.currentTime = 0
    currentTime.value = 0
    return
  }
  switchTrack(getNextIndex(1), true)
}

const onAudioError = async () => {
  if (!hasTrack.value) return
  const track = tracks.value[currentIndex.value]
  if (!track) return

  if (!track.decodeFailed) message.warning(`跳过无法解码: ${track.title}`)
  track.decodeFailed = true

  if (autoSkipping.value) return
  autoSkipping.value = true
  try {
    const nextIdx = getNextIndex(1)
    if (nextIdx < 0) {
      if (audioRef.value) {
        audioRef.value.pause();
        audioRef.value.removeAttribute('src')
      }
      isPlaying.value = false;
      message.error('目录内歌曲都无法解码')
    } else await switchTrack(nextIdx, true)
  } finally {
    autoSkipping.value = false
  }
}

const loadFromDirectory = async (dir: string) => {
  if (!dir.trim()) return
  loading.value = true
  try {
    const queue = [dir.trim()]
    const files: string[] = []
    const api = getMusicApi()

    while (queue.length > 0) {
      const entries = await api.listDirectory(queue.shift()!) as MusicDirectoryEntry[]
      for (const entry of entries) {
        if (entry.isDirectory) queue.push(entry.path)
        else if (AUDIO_EXTENSIONS.has((entry.name.match(/\.[^./\\]+$/)?.[0] || '').toLowerCase())) {
          files.push(entry.path)
          if (files.length >= MAX_TRACK_COUNT) break
        }
      }
      if (files.length >= MAX_TRACK_COUNT) break
    }

    if (!files.length) {
      tracks.value = [];
      currentIndex.value = 0;
      currentTime.value = 0;
      isPlaying.value = false
      return message.warning('无音频文件')
    }

    tracks.value.forEach(t => t.sourceUrl.startsWith('blob:') && URL.revokeObjectURL(t.sourceUrl))
    tracks.value = files.sort((a, b) => a.localeCompare(b, 'zh-CN')).map(path => ({
      path, title: path.split(/[\\/]/).pop()?.replace(/\.[^./\\]+$/, '') || '未知',
      artist: '未知歌手', album: '未知专辑', duration: 0, coverUrl: '', sourceUrl: '',
      lyrics: '', lyricLines: [], plainLyricLines: [], metadataLoaded: false, decodeFailed: false
    }))

    await switchTrack(0, true)
    message.success(files.length >= MAX_TRACK_COUNT ? `仅加载前 ${MAX_TRACK_COUNT} 首` : `已加载 ${files.length} 首`)
  } catch (e) {
    message.error(`加载失败: ${e}`)
  } finally {
    loading.value = false
  }
}

const chooseMusicDirectory = async () => {
  try {
    const path = await getMusicApi().selectDirectory()
    if (path) {
      musicStore.setMusicDirectory(path);
      await loadFromDirectory(path)
    }
  } catch (e) {
    message.error(`选择失败: ${e}`)
  }
}

watch(activeLyricIndex, async index => {
  if (index < 0 || !lyricPanelRef.value) return
  await nextTick()
  const el = lyricPanelRef.value.querySelector<HTMLElement>(`.lyric-line[data-index="${index}"]`)
  if (el) lyricPanelRef.value.scrollTo({
    top: Math.max(el.offsetTop - lyricPanelRef.value.clientHeight / 2, 0),
    behavior: 'smooth'
  })
})

onMounted(() => musicDirectory.value && loadFromDirectory(musicDirectory.value))
onBeforeUnmount(() => {
  tracks.value.forEach(t => t.sourceUrl.startsWith('blob:') && URL.revokeObjectURL(t.sourceUrl))
  if (audioRef.value) {
    audioRef.value.pause();
    audioRef.value.removeAttribute('src')
  }
})
</script>

<template>
  <div class="music-page">
    <a-card>
      <a-space class="toolbar" wrap>
        <a-button type="primary" :loading="loading" @click="chooseMusicDirectory">
          <template #icon>
            <folder-open-outlined/>
          </template>
          选择音乐目录
        </a-button>
        <a-button :disabled="!musicDirectory || loading" @click="musicDirectory && loadFromDirectory(musicDirectory)">
          重新加载
        </a-button>
        <span class="directory-text">{{ musicDirectory || '未选择目录' }}</span>
      </a-space>
    </a-card>

    <a-spin :spinning="loading" tip="正在加载音乐...">
      <div class="music-body">
        <a-card class="left-panel">
          <div class="cover-shell">
            <div class="cover-disc" :class="{ playing: isPlaying }">
              <img v-if="currentTrack?.coverUrl" class="cover-image" :src="currentTrack.coverUrl"
                   :alt="currentTrack?.title"/>
              <div v-else class="cover-fallback">♪</div>
              <div class="center-dot"/>
            </div>
          </div>
          <div class="track-meta">
            <h3>{{ currentTrack?.title || '暂无歌曲' }}</h3>
            <p>{{ currentTrack ? `${currentTrack.artist} · ${currentTrack.album}` : '请先选择音乐目录' }}</p>
            
            <div class="progress-bar">
              <span class="time-text">{{ formatDuration(currentTime) }}</span>
              <a-slider 
                class="progress-slider"
                :value="currentTime" 
                :max="currentTrack?.duration || 0" 
                :disabled="!hasTrack"
                :tooltip-visible="false"
                @change="val => currentTime = val as number"
                @afterChange="onSeek" 
              />
              <span class="time-text">{{ formatDuration(currentTrack?.duration || 0) }}</span>
            </div>
          </div>
          <a-space class="controls" size="middle">
            <a-button shape="circle" :disabled="!hasTrack" @click="playPrevious">
              <template #icon>
                <step-backward-outlined/>
              </template>
            </a-button>
            <a-button shape="circle" type="primary" :disabled="!hasTrack" @click="togglePlayPause">
              <template #icon>
                <pause-circle-outlined v-if="isPlaying"/>
                <play-circle-outlined v-else/>
              </template>
            </a-button>
            <a-button shape="circle" :disabled="!hasTrack" @click="playNext">
              <template #icon>
                <step-forward-outlined/>
              </template>
            </a-button>
          </a-space>
          <a-button class="mode-button" :disabled="!hasTrack" @click="togglePlayMode">
            <template #icon>
              <component :is="playModeIcon"/>
            </template>
            {{ playModeText }}
          </a-button>
          <div class="playlist">
            <div class="playlist-title">播放列表（{{ tracks.length }}）</div>
            <div class="playlist-body">
              <div v-for="(track, index) in tracks" :key="track.path" class="playlist-item"
                   :class="{ active: index === currentIndex }" @click="switchTrack(index, true)">
                <span class="track-index">{{ index + 1 }}.</span>
                <span class="track-title">{{ track.title }}</span>
                <span class="track-artist">{{ track.artist }}</span>
              </div>
            </div>
          </div>
        </a-card>

        <a-card class="right-panel" title="歌词">
          <div ref="lyricPanelRef" class="lyric-panel">
            <template v-if="currentTrack">
              <template v-if="currentLyricLines.length">
                <p v-for="(line, index) in currentLyricLines" :key="`${line.time}-${index}`" class="lyric-line"
                   :class="{ active: index === activeLyricIndex }" :data-index="index">
                  {{ line.text }}
                </p>
              </template>
              <template v-else-if="currentPlainLyricLines.length">
                <p v-for="(line, index) in currentPlainLyricLines" :key="`${line}-${index}`" class="lyric-line">{{
                    line
                  }}</p>
              </template>
              <p v-else class="lyric-empty">暂无歌词</p>
            </template>
            <p v-else class="lyric-empty">请选择音乐目录后开始播放</p>
          </div>
        </a-card>
      </div>
    </a-spin>
    <audio ref="audioRef" preload="metadata"
           @play="isPlaying = true; currentTrack && (currentTrack.decodeFailed = false)" @pause="isPlaying = false"
           @timeupdate="currentTime = audioRef?.currentTime || 0" @ended="onTrackEnded" @error="onAudioError"/>
  </div>
</template>

<style scoped>
.music-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  width: 100%;
  display: flex;
  align-items: center;
}

.directory-text {
  max-width: 560px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-body {
  display: grid;
  grid-template-columns: 420px minmax(0, 1fr);
  gap: 16px;
  min-height: calc(100vh - 240px);
}

.left-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cover-shell {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}

.cover-disc {
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(circle at 48% 48%, #222 0%, #1a1a1a 60%, #111 100%);
  border: 10px solid #050505;
  position: relative;
  overflow: hidden;
}

.cover-disc.playing {
  animation: disc-spin 10s linear infinite;
}

.cover-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-fallback {
  width: 100%;
  height: 100%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54px;
}

.center-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid #111;
  background: #efefef;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.track-meta {
  text-align: center;
}

.track-meta h3 {
  margin: 0;
}

.track-meta p {
  margin: 4px 0;
  color: #777;
}

.controls {
  display: flex;
  justify-content: center;
}

.mode-button {
  align-self: center;
}

.playlist {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  min-height: 220px;
  display: flex;
  flex-direction: column;
}

.playlist-title {
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 600;
}

.playlist-body {
  overflow: auto;
  max-height: 300px;
}

.playlist-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.playlist-item:hover {
  background: rgba(5, 5, 5, 0.05);
}

.playlist-item.active {
  background: rgba(24, 144, 255, 0.15);
}

.track-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-artist {
  color: #888;
  white-space: nowrap;
}

.right-panel {
  min-height: 100%;
}

.lyric-panel {
  height: calc(100vh - 260px);
  min-height: 360px;
  overflow: auto;
  padding: 8px 8px 20px;
}

.lyric-line {
  margin: 0;
  padding: 6px 0;
  color: #666;
  text-align: center;
  transition: color 0.2s ease, transform 0.2s ease;
}

.lyric-line.active {
  color: #1677ff;
  transform: scale(1.02);
  font-weight: 600;
}

.lyric-empty {
  color: #999;
  text-align: center;
  margin-top: 28px;
}

@keyframes disc-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1200px) {
  .music-body {
    grid-template-columns: 1fr;
  }

  .lyric-panel {
    height: 460px;
  }
}
</style>

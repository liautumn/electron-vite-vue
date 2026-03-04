import {defineStore} from 'pinia'
import {ref} from 'vue'

export type PlayMode = 'sequence' | 'random' | 'loop'

export const useMusicStore = defineStore(
    'music',
    () => {
        const musicDirectory = ref<string>('')
        const playMode = ref<PlayMode>('sequence')

        function setMusicDirectory(path: string) {
            musicDirectory.value = path
        }

        function setPlayMode(mode: PlayMode) {
            playMode.value = mode
        }

        return {
            musicDirectory,
            playMode,
            setMusicDirectory,
            setPlayMode,
        }
    },
    {
        persist: {
            key: 'music-store',
            storage: localStorage,
        },
    }
)

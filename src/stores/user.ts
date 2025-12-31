import {defineStore} from 'pinia'
import {ref, computed} from 'vue'

export const useUserStore = defineStore(
    'user',
    () => {
        // state
        const name = ref<string>('')
        const token = ref<string>('')

        // getters
        const getName = computed(() => name.value)
        const getToken = computed(() => token.value)

        // actions
        function setName(newName: string) {
            name.value = newName
        }

        function setToken(newToken: string) {
            token.value = newToken
        }

        function clearUser() {
            name.value = ''
            token.value = ''
        }

        return {
            name,
            token,
            getName,
            getToken,
            setName,
            setToken,
            clearUser,
        }
    },
    {
        // pinia-plugin-persist(-edstate) 配置
        persist: {
            key: 'user-store',
            storage: localStorage,
        },
    }
)

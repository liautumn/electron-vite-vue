import {defineStore} from 'pinia'

// @ts-ignore
export const useUserStore = defineStore('user', {
    state: () => ({
        name: '',
        token: '',
    }),

    getters: {
        getName: (state) => state.name,
        getToken: (state) => state.token,
    },

    actions: {
        setName(name: string) {
            this.name = name
        },
        setToken(token: string) {
            this.token = token
        },
        clearUser() {
            this.name = ''
            this.token = ''
        },
    },

    persist: {
        key: 'user-store',
        storage: localStorage, // 默认就是 localStorage
        paths: ['name', 'token'], // 指定存哪些
    },
})

import axios, {AxiosError, AxiosInstance} from 'axios'
import type {ApiResponse} from "../types/api";
import {useUserStore} from '../stores/user'

const request = axios.create({
    baseURL: import.meta.env.VITE_API_BASE,
    timeout: 10000,
})


/**
 * 请求拦截：自动带 token
 */
request.interceptors.request.use((config) => {
    const userStore = useUserStore()

    if (userStore.token) {
        config.headers.Authorization = `Bearer ${userStore.token}`
    }

    return config
})

/**
 * 响应拦截：统一解包
 */
request.interceptors.response.use(
    (response) => {
        const res = response.data as ApiResponse

        if (res.code !== 200) {
            return Promise.reject(new Error(res.msg || '请求失败'))
        }

        // 直接返回后端 data
        return res.data
    },
    (error: AxiosError) => {
        if (!navigator.onLine) {
            console.error('网络断开')
        }
        return Promise.reject(error)
    }
)

export default request

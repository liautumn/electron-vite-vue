import {createRouter, createWebHashHistory} from 'vue-router'
import HomeView from '../views/HomeView.vue'
import PiniaDemoView from '../views/PiniaDemoView.vue'
import SerialportView from "../views/SerialportView.vue";
import WebRtcDemoView from "../views/WebRtcDemoView.vue";

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeView,
        },
        {
            path: '/pinia-demo',
            name: 'pinia-demo',
            component: PiniaDemoView,
        },
        {
            path: '/serialport-demo',
            name: 'serialport-demo',
            component: SerialportView,
        },
        {
            path: '/webrtc-demo',
            name: 'webrtc-demo',
            component: WebRtcDemoView,
        },
    ],
})

export default router

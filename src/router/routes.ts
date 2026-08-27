import {RouterView, type RouteRecordRaw} from 'vue-router'
import HomeView from '../views/HomeView.vue'
import GuoxinRfidView from '../views/GuoxinRfidView.vue'
import LedDemoView from '../views/LedDemoView.vue'
import LockView from '../views/LockView.vue'
import MqttDemoView from '../views/MqttDemoView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import Rs232TcpView from '../views/Rs232TcpView.vue'
import SenseVoiceDemoView from '../views/SenseVoiceDemoView.vue'
import SqliteDemoView from '../views/SqliteDemoView.vue'
import Yolo26DemoView from '../views/Yolo26DemoView.vue'

export const routes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'home',
        component: HomeView,
        alias: '/home',
        meta: {
            title: '首页',
            keepAlive: true,
            permission: 'app:home:view',
        },
    },
    {
        path: '/demos',
        name: 'demos',
        component: RouterView,
        meta: {
            title: '示例合集',
            requiresAuth: false,
            permission: 'app:demos:view',
        },
        children: [
            {
                path: '',
                name: 'demos-redirect',
                redirect: '/demos/rs232-tcp-demo',
            },
            {
                path: 'rs232-tcp-demo',
                name: 'rs232-tcp-demo',
                component: Rs232TcpView,
                alias: '/rs232-tcp-demo',
                meta: {
                    title: 'RS232/TCP 通讯',
                    permission: 'app:demos:rs232-tcp',
                },
            },
            {
                path: 'mqtt-demo',
                name: 'mqtt-demo',
                component: MqttDemoView,
                alias: '/mqtt-demo',
                meta: {
                    title: 'MQTT Demo',
                    permission: 'app:demos:mqtt',
                },
            },
            {
                path: 'sqlite-demo',
                name: 'sqlite-demo',
                component: SqliteDemoView,
                alias: '/sqlite-demo',
                meta: {
                    title: 'SQLite CRUD Demo',
                    permission: 'app:demos:sqlite',
                },
            },
            {
                path: 'sensevoice-demo',
                name: 'sensevoice-demo',
                component: SenseVoiceDemoView,
                alias: '/sensevoice-demo',
                meta: {
                    title: 'SenseVoice 语音识别',
                    permission: 'app:demos:sensevoice',
                },
            },
            {
                path: 'guoxin-rfid-demo',
                name: 'guoxin-rfid-demo',
                component: GuoxinRfidView,
                alias: '/guoxin-rfid-demo',
                meta: {
                    title: '国芯 RFID 测试',
                    permission: 'app:demos:guoxin-rfid',
                },
            },
            {
                path: 'lock-demo',
                name: 'lock-demo',
                component: LockView,
                alias: '/lock-demo',
                meta: {
                    title: 'Lock 锁控板 测试',
                    permission: 'app:demos:lock',
                },
            },
            {
                path: 'led-demo',
                name: 'led-demo',
                component: LedDemoView,
                alias: '/led-demo',
                meta: {
                    title: 'LED 指示灯控制',
                    permission: 'app:demos:led',
                },
            },
            {
                path: 'yolo26-demo',
                name: 'yolo26-demo',
                component: Yolo26DemoView,
                alias: '/yolo26-demo',
                meta: {
                    title: 'YOLO26 ONNX 测试',
                    permission: 'app:demos:yolo26',
                },
            },
        ],
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: NotFoundView,
        meta: {
            title: '页面不存在',
            layout: 'blank',
        },
    },
]

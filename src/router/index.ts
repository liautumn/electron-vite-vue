import {createRouter, createWebHashHistory} from 'vue-router'
import HomeView from '../views/HomeView.vue'
import PiniaDemoView from '../views/PiniaDemoView.vue'

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
  ],
})

export default router

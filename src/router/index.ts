import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { getToken } from '@/api/client'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
  },
  {
    path: '/editor/:projectId',
    name: 'Editor',
    component: () => import('@/views/EditorView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  const isPublic = to.meta.public === true
  const isAuthenticated = Boolean(getToken())

  if (!isPublic && !isAuthenticated) {
    next({ name: 'Login' })
    return
  }

  if (isPublic && isAuthenticated && to.name === 'Login') {
    next({ name: 'Dashboard' })
    return
  }

  next()
})

export default router

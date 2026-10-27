import { createRouter, createWebHistory } from 'vue-router'

import { SITE_NAME } from '@/config/app'
import PublicLayout from '@/layouts/PublicLayout.vue'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    terminalCommand?: 'status' | 'email' | 'sessions'
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: PublicLayout,
      children: [
        {
          path: '',
          name: 'login',
          alias: '/login',
          component: () => import('@/pages/LoginPage.vue'),
          meta: { title: 'Sign in' },
        },
        {
          path: 'auth/github/callback',
          name: 'github-callback',
          component: () => import('@/pages/GithubCallbackPage.vue'),
          meta: { title: 'Signing in' },
        },
        {
          path: 'email/verify',
          name: 'email-verify',
          alias: ['/account/email/verify', '/nav/profiles/email/verify'],
          component: () => import('@/pages/EmailVerifyPage.vue'),
          meta: { title: 'Verify email' },
        },
        {
          path: ':pathMatch(.*)*',
          name: 'not-found',
          component: () => import('@/pages/NotFoundPage.vue'),
          meta: { title: 'Not found' },
        },
      ],
    },
    {
      path: '/account',
      name: 'account',
      component: () => import('@/pages/TerminalPage.vue'),
      meta: { title: 'Account', requiresAuth: true, terminalCommand: 'status' },
    },
    {
      path: '/account/email',
      name: 'account-email',
      component: () => import('@/pages/TerminalPage.vue'),
      meta: { title: 'Email', requiresAuth: true, terminalCommand: 'email' },
    },
    {
      path: '/account/sessions',
      name: 'account-sessions',
      component: () => import('@/pages/TerminalPage.vue'),
      meta: { title: 'Sessions', requiresAuth: true, terminalCommand: 'sessions' },
    },
    {
      path: '/authorize',
      name: 'authorize',
      alias: ['/oauth/authorize', '/auth/authorize', '/account/authorize'],
      component: () => import('@/pages/AuthorizePage.vue'),
      meta: { title: 'Authorize', requiresAuth: true },
    },
  ],
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }
    if (to.hash) {
      return { el: to.hash }
    }
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth) {
    await auth.initialize()
    if (auth.status === 'anonymous' || auth.status === 'unavailable') {
      const reason =
        auth.status === 'unavailable'
          ? 'unavailable'
          : auth.sessionLossReason === 'expired'
            ? 'expired'
            : auth.sessionLossReason === 'revoked'
              ? 'revoked'
              : undefined
      return {
        name: 'login',
        query: {
          returnTo: to.fullPath,
          ...(reason ? { reason } : {}),
        },
      }
    }
  } else if (auth.status === 'unknown') {
    void auth.initialize()
  }

  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${SITE_NAME}` : SITE_NAME
})

export default router

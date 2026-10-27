<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { API_BASE_URL } from '@/config/app'
import { describeError, describeErrorLines } from '@/lib/errors'
import { firstQueryValue, safeInternalPath } from '@/lib/navigation'
import { useAuthStore } from '@/stores/auth'
import styles from './loginPage.module.css'

const auth = useAuthStore()
const route = useRoute()

const bgId = Math.floor(Math.random() * 5) + 1
const bgSrc = `https://cdn.jawbts.org/photos/ocean-${bgId}.webp`
const loadStage = ref(0)
const loadError = ref(false)
const uiReady = ref(false)
const bannerText = ref({ a: 'Hello', b: 'World!' })
const username = ref('')
const loginLoading = ref(false)
const error = ref('')
const errorDetails = ref<string[]>([])
const attempted = ref(false)

let fadeTimer: number | undefined
let timeoutTimer: number | undefined
let uiTimer: number | undefined

const returnTo = computed(() => {
  const target = safeInternalPath(route.query.returnTo, '/account')
  if (
    target === '/' ||
    target.startsWith('/?') ||
    target.startsWith('/login') ||
    target.startsWith('/auth/github/callback')
  ) {
    return '/account'
  }
  return target
})

const sessionReason = computed(() => {
  const reason = firstQueryValue(route.query.reason)
  return reason === 'expired' || reason === 'revoked' || reason === 'unavailable'
    ? reason
    : null
})

const reasonText = computed(() => {
  const reason = sessionReason.value
  if (reason === 'expired') {
    return 'Your session expired. Sign in again.'
  }
  if (reason === 'revoked') {
    return 'Your session was revoked. Sign in again.'
  }
  if (reason === 'unavailable') {
    return auth.lastError ?? "We couldn't reach Jawbts. Check your connection and try again."
  }
  return ''
})

function onImageLoad(): void {
  loadStage.value = 1
  fadeTimer = window.setTimeout(() => {
    loadStage.value = 2
  }, 500)
}

function onImageError(): void {
  loadError.value = true
  loadStage.value = 2
}

function clearError(): void {
  error.value = ''
  errorDetails.value = []
  attempted.value = false
}

async function submit(): Promise<void> {
  if (loginLoading.value || !username.value.trim()) {
    return
  }
  attempted.value = true
  error.value = ''
  errorDetails.value = []
  loginLoading.value = true
  try {
    await auth.startGithubLogin(username.value, returnTo.value)
  } catch (caught) {
    error.value = describeError(caught)
    errorDetails.value = describeErrorLines(caught)
    loginLoading.value = false
  }
}

onMounted(async () => {
  // Do not hold the login form hostage to an 8.5MB CDN background. The
  // background stays hidden (opacity 0) until it loads; the form can open
  // after a short grace period even if the image is still downloading.
  uiTimer = window.setTimeout(() => {
    uiReady.value = true
  }, 1500)

  timeoutTimer = window.setTimeout(() => {
    if (loadStage.value === 0) {
      loadError.value = true
      loadStage.value = 2
    }
  }, 15000)

  try {
    const res = await fetch(`${API_BASE_URL}/text`)
    if (res.ok) {
      const data = await res.json()
      if (data?.data?.a) {
        bannerText.value = { a: data.data.a, b: data.data.b ?? '' }
      }
    }
  } catch {
    // The quote is decorative.
  }
})

onUnmounted(() => {
  if (fadeTimer !== undefined) {
    window.clearTimeout(fadeTimer)
  }
  if (timeoutTimer !== undefined) {
    window.clearTimeout(timeoutTimer)
  }
  if (uiTimer !== undefined) {
    window.clearTimeout(uiTimer)
  }
})
</script>

<template>
  <div class="relative h-[100dvh] w-screen overflow-hidden bg-[#0f171e]">
    <div
      class="fixed inset-0 flex flex-col items-center justify-center transition-opacity duration-500"
      :class="uiReady || loadStage > 0 ? 'pointer-events-none opacity-0' : 'opacity-100'"
      :aria-hidden="uiReady || loadStage > 0"
    >
      <p v-if="!loadError" class="animate-pulse text-white/60">Loading...</p>
    </div>

    <img
      :src="bgSrc"
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable="false"
      class="h-full w-full object-cover"
      :class="[
        loadStage > 1 ? styles.variableSpeedFade : 'opacity-0',
        styles.backgroundImage,
      ]"
      @load="onImageLoad"
      @error="onImageError"
      @dragstart.prevent
    />

    <div
      class="absolute inset-0 m-auto flex h-1/2 w-[85%] flex-col justify-center text-center sm:w-1/2"
    >
      <div :class="styles.bannerDiv">
        <header
          class="transition-all duration-500"
          :class="[
            styles.bannerBorder,
            uiReady || loadStage >= 1 ? 'opacity-100' : 'pointer-events-none opacity-0',
          ]"
        >
          <h1
            :class="styles.logoBrightness"
            class="mt-1 mb-2 inline-block whitespace-nowrap text-3xl font-black tracking-wider text-sea-300 md:text-6xl"
          >
            J a w b t s
          </h1>
        </header>

        <template v-if="uiReady || loadStage > 1">
          <div
            class="flex min-h-12 flex-col items-center justify-center break-words text-center"
            :class="[
              styles.touchQuote,
              attempted && error
                ? 'text-[#ff8a8a]'
                : loginLoading
                  ? 'text-white'
                  : 'text-[rgba(255,255,255,0)] transition hover:text-white',
            ]"
          >
            <template v-if="attempted && error">
              <p
                class="text-xs leading-4 sm:text-sm sm:leading-5"
                role="alert"
                :title="error"
              >
                {{ error }}
              </p>
              <p
                v-for="(line, index) in errorDetails"
                :key="index"
                class="text-[11px] leading-4 text-[#ffb4b4]"
              >
                {{ line }}
              </p>
            </template>
            <p
              v-else-if="loginLoading"
              class="text-xs leading-4 sm:text-sm sm:leading-5"
              role="status"
            >
              Redirecting...
            </p>
            <template v-else>
              <p>{{ bannerText.a }}</p>
              <p>{{ bannerText.b }}</p>
            </template>
          </div>

          <p
            v-if="reasonText"
            class="mx-auto mt-3 max-w-md text-xs leading-4 text-[#ffd28a]"
            role="status"
          >
            {{ reasonText }}
          </p>

          <footer
            class="group my-4 text-[rgba(255,255,255,0)] transition hover:text-white focus-within:text-white"
          >
            <form
              v-if="auth.status !== 'unknown' && !auth.isAuthenticated"
              class="grid place-items-center"
              @submit.prevent="submit"
            >
              <input
                v-model="username"
                :class="styles.touchInput"
                class="mt-5 w-56 bg-transparent text-center text-base text-white caret-white focus:outline-none focus:ring-0 focus-visible:ring-0"
                type="text"
                name="username"
                placeholder="GitHub username"
                aria-label="GitHub username"
                autocomplete="username"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                maxlength="39"
                :disabled="loginLoading"
                @input="clearError"
              />
              <button
                :class="styles.touchButton"
                class="mt-8 h-10 w-24 border-2 border-transparent text-lg text-transparent transition group-hover:border-white group-hover:text-white group-focus-within:text-white focus-visible:border-white disabled:opacity-50"
                type="submit"
                :disabled="loginLoading || !username.trim()"
              >
                Sign in
              </button>
            </form>

            <RouterLink v-else-if="auth.isAuthenticated" :to="returnTo" :class="styles.touchReveal" class="my-10 inline-block text-lg text-transparent group-hover:text-white focus:text-white">
              Enter
            </RouterLink>
          </footer>
        </template>
      </div>
    </div>
  </div>
</template>

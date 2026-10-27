<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TerminalLine from '@/components/TerminalLine.vue'
import TerminalShell from '@/components/TerminalShell.vue'
import { STORAGE_KEYS } from '@/config/app'
import { describeError, describeErrorLines } from '@/lib/errors'
import { firstQueryValue, safeInternalPath } from '@/lib/navigation'
import type { TerminalEntry, TerminalKind } from '@/lib/terminal'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const shell = ref<InstanceType<typeof TerminalShell> | null>(null)
const lines = ref<TerminalEntry[]>([])
const busy = ref(false)
const redirectTarget = ref('/account')
let started = false
let redirectTimer: number | undefined

function print(kind: TerminalKind, text: string): void {
  lines.value.push({ kind, text })
  void nextTick(() => shell.value?.scrollToBottom())
}

function readStoredReturnTo(): string {
  try {
    return safeInternalPath(sessionStorage.getItem(STORAGE_KEYS.returnTo), '/account')
  } catch {
    return '/account'
  }
}

function fail(message: string, error?: unknown): void {
  busy.value = false
  print('error', message)
  if (error !== undefined) {
    for (const line of describeErrorLines(error)) {
      print('muted', line)
    }
  }
  print('muted', 'commands    retry login home')
}

async function retrySavedSession(): Promise<void> {
  if (busy.value) {
    return
  }
  busy.value = true
  print('muted', 'retrying saved session...')
  try {
    const ok = await auth.retrySession()
    if (ok) {
      print('ok', 'session restored')
      print('muted', `redirecting to ${redirectTarget.value}`)
      redirectTimer = window.setTimeout(() => {
        void router.replace(safeInternalPath(redirectTarget.value))
      }, 400)
    } else {
      fail('could not restore the session')
    }
  } catch (caught) {
    fail(describeError(caught), caught)
  } finally {
    busy.value = false
  }
}

async function handleSubmit(raw: string): Promise<void> {
  if (busy.value) {
    return
  }
  const input = raw.trim().toLowerCase()
  print('command', `> ${raw}`)
  if (input === 'retry') {
    if (auth.status !== 'unavailable') {
      print('warn', 'no saved session to retry')
      return
    }
    await retrySavedSession()
    return
  }
  if (input === 'login') {
    void router.push({ name: 'login', query: { returnTo: redirectTarget.value } })
    return
  }
  if (input === 'home') {
    void router.push({ name: 'login' })
    return
  }
  if (input === 'help') {
    print('muted', 'commands    retry login home')
    return
  }
  print('warn', 'commands    retry login home')
}

onMounted(async () => {
  if (started) {
    return
  }
  started = true
  print('muted', 'github callback')
  redirectTarget.value = readStoredReturnTo()

  const code = firstQueryValue(route.query.code)
  const oauthState = firstQueryValue(route.query.state)
  const oauthError = firstQueryValue(route.query.error)
  const oauthDescription = firstQueryValue(route.query.error_description)

  await router.replace({ name: 'github-callback' })

  if (oauthError) {
    fail(oauthDescription || oauthError)
    return
  }
  if (!code || !oauthState) {
    fail('missing code or state')
    return
  }

  busy.value = true
  print('muted', 'exchanging github authorization...')
  try {
    const target = await auth.completeGithubLogin(code, oauthState)
    redirectTarget.value = target
    print('ok', 'signed in')
    print('muted', `redirecting to ${target}`)
    redirectTimer = window.setTimeout(() => {
      void router.replace(target)
    }, 400)
  } catch (caught) {
    fail(describeError(caught), caught)
  } finally {
    busy.value = false
  }
})

onBeforeUnmount(() => {
  if (redirectTimer !== undefined) {
    window.clearTimeout(redirectTimer)
  }
})
</script>

<template>
  <TerminalShell
    ref="shell"
    prompt="callback>"
    placeholder="retry / login / home"
    :disabled="busy"
    right="github.oauth"
    label="GitHub callback command"
    @submit="handleSubmit"
  >
    <TerminalLine
      v-for="(line, index) in lines"
      :key="index"
      :kind="line.kind"
      :text="line.text"
    />
  </TerminalShell>
</template>

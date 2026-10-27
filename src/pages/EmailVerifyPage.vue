<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TerminalLine from '@/components/TerminalLine.vue'
import TerminalShell from '@/components/TerminalShell.vue'
import { jawbtsApi } from '@/lib/api'
import { describeError, describeErrorLines } from '@/lib/errors'
import { firstQueryValue } from '@/lib/navigation'
import type { TerminalEntry, TerminalKind } from '@/lib/terminal'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const shell = ref<InstanceType<typeof TerminalShell> | null>(null)
const lines = ref<TerminalEntry[]>([])
const busy = ref(false)

function print(kind: TerminalKind, text: string): void {
  lines.value.push({ kind, text })
  void nextTick(() => shell.value?.scrollToBottom())
}

function printError(error: unknown): void {
  print('error', describeError(error))
  for (const line of describeErrorLines(error)) {
    print('muted', line)
  }
}

async function verifyToken(token: string): Promise<void> {
  if (busy.value) {
    return
  }
  const trimmed = token.trim()
  if (trimmed.length < 20 || trimmed.length > 200) {
    print('error', 'invalid token')
    print('muted', 'usage: verify <token>')
    return
  }
  busy.value = true
  print('muted', 'verifying...')
  try {
    const result = await jawbtsApi.confirmEmail(trimmed)
    if (auth.isAuthenticated) {
      void auth.loadProfile({ force: true }).catch(() => undefined)
    }
    print('ok', `email confirmed: ${result.email}`)
    print('muted', auth.isAuthenticated ? 'commands    account home' : 'commands    login home')
  } catch (caught) {
    printError(caught)
  } finally {
    busy.value = false
  }
}

async function handleSubmit(raw: string): Promise<void> {
  if (busy.value) {
    return
  }
  const input = raw.trim()
  const lower = input.toLowerCase()
  if (lower === 'login') {
    void router.push({ name: 'login', query: { returnTo: '/account/email' } })
    return
  }
  if (lower === 'home') {
    void router.push({ name: 'login' })
    return
  }
  if ((lower === 'account' || lower === 'email') && auth.isAuthenticated) {
    void router.push({ name: 'account-email' })
    return
  }

  const match = /^verify\s+(.+)$/i.exec(input)
  const token = match?.[1]?.trim() ?? (input.length >= 20 ? input : '')
  print('command', '$ verify <token>')
  if (!token) {
    print('warn', 'usage: verify <token>')
    return
  }
  await verifyToken(token)
}

onMounted(async () => {
  print('muted', 'email verification')
  const token = firstQueryValue(route.query.token) ?? firstQueryValue(route.query.code)
  if (!token) {
    print('muted', 'paste the confirmation token')
    print('muted', 'usage: verify <token>')
    return
  }
  await router.replace({ name: 'email-verify' })
  print('command', '$ verify <token>')
  await verifyToken(token)
})
</script>

<template>
  <TerminalShell
    ref="shell"
    prompt="verify>"
    placeholder="verify <token>"
    :disabled="busy"
    right="email.verify"
    label="Email verification command"
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

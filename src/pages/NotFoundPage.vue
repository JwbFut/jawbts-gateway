<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TerminalLine from '@/components/TerminalLine.vue'
import TerminalShell from '@/components/TerminalShell.vue'
import type { TerminalEntry, TerminalKind } from '@/lib/terminal'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const shell = ref<InstanceType<typeof TerminalShell> | null>(null)
const lines = ref<TerminalEntry[]>([])

function print(kind: TerminalKind, text: string): void {
  lines.value.push({ kind, text })
  void nextTick(() => shell.value?.scrollToBottom())
}

function handleSubmit(raw: string): void {
  const input = raw.trim().toLowerCase()
  print('command', `404> ${raw}`)
  if (input === 'home' || input === 'login') {
    void router.push({ name: 'login' })
    return
  }
  if (input === 'account') {
    if (auth.isAuthenticated) {
      void router.push({ name: 'account' })
    } else {
      print('warn', 'not signed in — type login')
    }
    return
  }
  if (input === 'help') {
    print('muted', 'commands    home login account')
    return
  }
  print('warn', 'commands    home login account')
}

onMounted(() => {
  print('muted', 'not found')
  print('error', `404: ${route.fullPath}`)
  print('muted', 'commands    home login account')
})
</script>

<template>
  <TerminalShell
    ref="shell"
    prompt="404>"
    placeholder="home / login / account"
    right="not.found"
    label="Not found command"
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

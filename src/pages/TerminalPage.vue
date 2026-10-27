<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TerminalLine from '@/components/TerminalLine.vue'
import TerminalShell from '@/components/TerminalShell.vue'
import { BUILD_HASH, LICENSE_NOTICE, SITE_NAME } from '@/config/app'
import { describeError, describeErrorLines } from '@/lib/errors'
import { formatDate, formatDateTime, formatRelative } from '@/lib/format'
import { redactCommand, type TerminalEntry, type TerminalKind } from '@/lib/terminal'
import { greetingFor } from '@/lib/welcome'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const shell = ref<InstanceType<typeof TerminalShell> | null>(null)
const lines = ref<TerminalEntry[]>([])
const busy = ref(false)
/** Suppresses the session-loss redirect while the logout command owns it. */
const loggingOut = ref(false)

const initial = computed(() => String(route.meta.terminalCommand ?? 'status'))

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

function welcome(): void {
  const name = auth.username ?? 'there'
  print('output', `${SITE_NAME} Gateway [Build ${BUILD_HASH}]`)
  print('output', LICENSE_NOTICE)
  print('output', '')
  print('output', `Good ${greetingFor()}, ${name}.`)
  print('muted', "type 'help' for commands")
}

async function ensureProfile(): Promise<boolean> {
  if (auth.profile) {
    return true
  }
  if (auth.profileError) {
    print('muted', auth.profileError)
  }
  try {
    await auth.loadProfile({ force: true })
    return true
  } catch (caught) {
    printError(caught)
    return false
  }
}

async function runBusy(operation: () => Promise<void>): Promise<void> {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    await operation()
  } finally {
    busy.value = false
  }
}

async function statusCommand(): Promise<void> {
  await runBusy(async () => {
    if (auth.profileLoading) {
      print('muted', 'refreshing profile...')
    }
    if (!(await ensureProfile())) {
      return
    }
    const profile = auth.profile
    if (!profile) {
      return
    }
    print('output', `user        ${profile.name}`)
    print('output', `github      ${profile.githubId}`)
    print('output', `email       ${auth.email ?? 'pending confirmation'}`)
    print('output', `permissions ${auth.permissions.join(' ') || 'none'}`)
    print('output', `scopes      ${auth.scopes.join(' ') || 'none'}`)
    print(
      'output',
      `refresh     ${auth.refreshExpiresAt ? formatRelative(auth.refreshExpiresAt) : 'active'}`,
    )
    print('output', `member      ${formatDate(profile.createdAt)}`)
  })
}

async function emailCommand(args: string[]): Promise<void> {
  if (args[0]?.toLowerCase() === 'set') {
    const address = args.slice(1).join(' ').trim()
    if (!address) {
      print('warn', 'usage: email set <address>')
      return
    }
    if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      print('error', 'invalid email address')
      return
    }
    await runBusy(async () => {
      try {
        await auth.updateEmail(address)
        // The API returns the profile without an email while a change is
        // pending. If the address was unchanged it returns the active email,
        // so do not claim a confirmation was sent in that case.
        if (auth.emailChangePending) {
          print('ok', `confirmation requested for ${address}`)
        } else {
          print('ok', `email unchanged: ${auth.email ?? address}`)
        }
      } catch (caught) {
        printError(caught)
      }
    })
    return
  }

  if (!(await ensureProfile())) {
    return
  }
  print('output', `email       ${auth.email ?? 'pending confirmation'}`)
  print('output', `status      ${auth.emailChangePending ? 'pending confirmation' : 'active'}`)
  print('muted', 'usage       email set <address>')
}

async function sessionsCommand(): Promise<void> {
  await runBusy(async () => {
    try {
      const result = await auth.listSessions()
      const parents = result.sessions.filter((session) => session.type === 'GITHUB_LOGIN')
      print('output', 'login sessions')
      if (parents.length === 0) {
        print('muted', '  none')
      }
      for (const parent of parents) {
        const refresh =
          result.sessions.find(
            (session) => session.type === 'REFRESH_TOKEN' && session.parentId === parent.id,
          ) ?? null
        const current = refresh?.id === auth.currentSessionId
        print('output', `  ${parent.id}${current ? ' (current)' : ''}`)
        print(
          'muted',
          `    refresh ${refresh?.id ?? 'pending'} · created ${formatDateTime(
            parent.createdAt,
          )} · expires ${formatRelative(refresh?.expiresAt ?? parent.expiresAt)}`,
        )
      }

      const delegated = result.sessions
        .filter((session) => session.type === 'DELEGATED_TOKEN')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      print('output', 'delegated tokens')
      if (delegated.length === 0) {
        print('muted', '  none')
      }
      for (const session of delegated) {
        print('output', `  ${session.id}`)
        print(
          'muted',
          `    ${session.label || 'unlabeled'} · ${
            session.permissions.join(' ') || 'no scopes'
          } · ${formatRelative(session.expiresAt)}`,
        )
      }
      print('muted', 'usage: revoke <session-id>')
    } catch (caught) {
      printError(caught)
    }
  })
}

async function revokeCommand(args: string[]): Promise<void> {
  const id = args[0]?.trim() ?? ''
  if (!id || args.length > 1) {
    print('warn', 'usage: revoke <session-id>')
    return
  }
  await runBusy(async () => {
    try {
      const { wasCurrent } = await auth.revokeSession(id)
      print('ok', `session revoked: ${id}`)
      if (wasCurrent || !auth.isAuthenticated) {
        print('warn', 'session ended')
        await router.push({ name: 'login', query: { reason: 'revoked' } })
      }
    } catch (caught) {
      printError(caught)
    }
  })
}

async function logoutCommand(): Promise<void> {
  if (busy.value) {
    return
  }
  busy.value = true
  loggingOut.value = true
  let stay = false
  try {
    const result = await auth.logout()
    if (result.revoked) {
      print('ok', 'signed out')
    } else if (result.error) {
      print(
        'warn',
        `signed out on this device, but the server session may still be active: ${result.error}`,
      )
      print('muted', "type 'login' or 'home' to continue")
      stay = true
    } else {
      print('ok', 'signed out')
    }
  } finally {
    busy.value = false
  }
  if (!stay) {
    await router.push({ name: 'login' })
  }
}

function helpCommand(): void {
  print('output', 'commands')
  print('muted', '  welcome                   greet and show what to do')
  print('muted', '  status                    account status')
  print('muted', '  email                     current email')
  print('muted', '  email set <address>       request an email change')
  print('muted', '  sessions                  login sessions and delegated tokens')
  print('muted', '  revoke <session-id>       revoke a session by its id')
  print('muted', '  logout                    sign out')
  print('muted', '  clear                     clear the screen')
}

function clearCommand(): void {
  lines.value = []
}

function homeCommand(): void {
  if (route.name === 'account') {
    print('muted', 'already home')
    return
  }
  void router.push({ name: 'account' })
}

function loginCommand(): void {
  void router.push({ name: 'login', query: { returnTo: route.fullPath } })
}

async function execute(input: string): Promise<void> {
  const parts = input.trim().split(/\s+/)
  const command = parts[0]?.toLowerCase() ?? ''
  const args = parts.slice(1)

  switch (command) {
    case 'help':
      helpCommand()
      return
    case 'welcome':
      welcome()
      return
    case 'status':
      await statusCommand()
      return
    case 'whoami':
      print('output', auth.username ?? 'anonymous')
      return
    case 'email':
      await emailCommand(args)
      return
    case 'sessions':
      await sessionsCommand()
      return
    case 'revoke':
      await revokeCommand(args)
      return
    case 'logout':
      await logoutCommand()
      return
    case 'clear':
      clearCommand()
      return
    case 'home':
    case 'account':
      homeCommand()
      return
    case 'login':
      loginCommand()
      return
    default:
      print('error', `command not found: ${command} (type 'help')`)
  }
}

async function onSubmit(raw: string): Promise<void> {
  if (busy.value) {
    return
  }
  print('command', `$ ${redactCommand(raw)}`)
  try {
    await execute(raw)
  } catch (caught) {
    printError(caught)
  }
}

onMounted(async () => {
  // The landing page greets the user instead of dumping account status. Other
  // terminal pages greet and then run their own command.
  welcome()
  if (initial.value !== 'status') {
    print('command', `$ ${initial.value}`)
    try {
      await execute(initial.value)
    } catch (caught) {
      printError(caught)
    }
  }
})

watch(
  () => route.meta.terminalCommand,
  (command) => {
    if (!command) {
      return
    }
    lines.value = []
    busy.value = false
    welcome()
    if (command !== 'status') {
      print('command', `$ ${command}`)
      void execute(command).catch((error: unknown) => printError(error))
    }
  },
)

// A session can expire or be revoked while a command page is open; the router
// guard only runs on navigation, so react to the store directly.
watch(
  () => auth.status,
  (status) => {
    if (loggingOut.value) {
      return
    }
    if (status !== 'anonymous' && status !== 'unavailable') {
      return
    }
    const reason =
      status === 'unavailable'
        ? 'unavailable'
        : auth.sessionLossReason === 'expired'
          ? 'expired'
          : auth.sessionLossReason === 'revoked'
            ? 'revoked'
            : undefined
    void router.replace({
      name: 'login',
      query: {
        returnTo: route.fullPath,
        ...(reason ? { reason } : {}),
      },
    })
  },
)
</script>

<template>
  <TerminalShell
    ref="shell"
    prompt="$"
    placeholder="type a command…"
    :disabled="busy"
    label="Gateway command"
    @submit="onSubmit"
  >
    <TerminalLine
      v-for="(line, index) in lines"
      :key="index"
      :kind="line.kind"
      :text="line.text"
    />
  </TerminalShell>
</template>

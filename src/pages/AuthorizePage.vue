<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TerminalLine from '@/components/TerminalLine.vue'
import TerminalShell from '@/components/TerminalShell.vue'
import { describeAllowedHosts } from '@/config/allowlist'
import { permissionLabel } from '@/config/scopes'
import {
  buildErrorRedirect,
  buildSuccessRedirect,
  parseAuthorizeQuery,
  type AuthorizeErrorCode,
  type TokenDelivery,
} from '@/lib/authorize'
import { describeError, describeErrorLines } from '@/lib/errors'
import type { TerminalEntry, TerminalKind } from '@/lib/terminal'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const shell = ref<InstanceType<typeof TerminalShell> | null>(null)
const lines = ref<TerminalEntry[]>([])
const busy = ref(false)

const parsed = computed(() => parseAuthorizeQuery(route.query))
const request = computed(() => (parsed.value.ok ? parsed.value.request : null))
const failure = computed(() => (parsed.value.ok ? null : parsed.value))
const allowed = describeAllowedHosts().join(', ')
const invalidErrorCode = computed<AuthorizeErrorCode>(() =>
  (failure.value?.errors ?? []).some((message) => message.toLowerCase().includes('scope'))
    ? 'invalid_scope'
    : 'invalid_request',
)

let redirectTimer: number | undefined

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

function question(): void {
  print('output', ' ')
  print('output', 'Authorize? [y/N]')
}

function printRequest(): void {
  const current = request.value
  if (!current) {
    return
  }
  print('muted', 'authorization request')
  print('output', `app         ${current.appName ?? current.destination.hostname}`)
  print('output', `destination ${current.destination.hostname}`)
  print('muted', `            ${current.redirectUri}`)
  print('output', 'scopes')
  for (const name of current.scopes) {
    print('output', `  - ${permissionLabel(name)}`)
    print('muted', `    ${name}`)
  }
  print('output', 'refresh     a 90-day refresh token is included')
  print(
    'warn',
    'warning: the destination will also receive a 90-day refresh token',
  )
  if (current.label) {
    print('output', `label       ${current.label}`)
  }
  if (current.state) {
    print('output', `state       ${current.state}`)
  }
  if (current.responseMode === 'query') {
    print('warn', 'warning: query mode puts tokens in the URL')
  }
  question()
}

function printFailure(): void {
  const current = failure.value
  if (!current) {
    return
  }
  print('error', 'invalid request')
  for (const message of current.errors) {
    print('error', `  ${message}`)
  }
  if (current.redirectUri) {
    print('muted', `destination ${current.redirectUri}`)
  }
  print('muted', `allowed     ${allowed}`)
  print('muted', current.target ? 'commands    home error' : 'commands    home')
}

function printNotPermitted(): void {
  const current = request.value
  if (!current) {
    return
  }
  print('warn', 'not permitted')
  print('error', 'missing issue_tokens')
  print('muted', `destination ${current.destination.hostname}`)
  print('muted', 'commands    home deny')
}

function home(): void {
  void router.push({ name: 'account' })
}

function login(): void {
  void router.push({ name: 'login', query: { returnTo: route.fullPath } })
}

function targetForResponse() {
  return request.value ?? failure.value?.target ?? null
}

function finishRedirect(url: string, host: string): void {
  print('muted', `redirecting to ${host}`)
  redirectTimer = window.setTimeout(() => {
    window.location.assign(url)
  }, 500)
}

async function approve(): Promise<void> {
  const current = request.value
  if (!current || busy.value || !auth.canIssueTokens) {
    return
  }
  busy.value = true
  print('muted', 'issuing token...')
  try {
    const result = await auth.issueToken(current.scopes, current.label ?? undefined)
    // The authorize contract always delivers the API's refresh token; there is
    // no access-only path and include_refresh_token is intentionally ignored.
    const delivery: TokenDelivery = {
      token: result.token,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
      scope: result.scope,
      tokenId: result.tokenId,
      refreshToken: result.refreshToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    }
    print('ok', 'authorized')
    finishRedirect(buildSuccessRedirect(current, delivery), current.destination.hostname)
  } catch (caught) {
    printError(caught)
    busy.value = false
    question()
  }
}

function deny(): void {
  if (busy.value) {
    return
  }
  busy.value = true
  print('ok', 'denied')
  const target = targetForResponse()
  if (!target) {
    void router.push({ name: 'account' })
    return
  }
  finishRedirect(
    buildErrorRedirect(target, 'access_denied', 'The user denied the authorization request.'),
    target.destination.hostname,
  )
}

function returnInvalid(): void {
  const current = failure.value
  if (!current?.target || busy.value) {
    return
  }
  busy.value = true
  print('muted', 'returning error...')
  finishRedirect(
    buildErrorRedirect(current.target, invalidErrorCode.value, current.errors.join(' ')),
    current.target.destination.hostname,
  )
}

async function handleSubmit(raw: string): Promise<void> {
  if (busy.value) {
    return
  }
  const input = raw.trim().toLowerCase()
  print('command', `> ${raw}`)

  if (!auth.isAuthenticated) {
    if (input === 'login') {
      login()
    } else {
      print('warn', 'login required — type login')
    }
    return
  }

  if (failure.value) {
    if (input === 'home') {
      home()
    } else if (input === 'error') {
      returnInvalid()
    } else {
      print('warn', failure.value.target ? 'type home or error' : 'type home')
    }
    return
  }

  if (!auth.canIssueTokens) {
    if (input === 'home') {
      home()
    } else if (input === 'deny' || input === 'n' || input === 'no') {
      deny()
    } else {
      print('warn', 'type home or deny')
    }
    return
  }

  if (input === 'y' || input === 'yes') {
    await approve()
    return
  }
  if (input === 'n' || input === 'no') {
    deny()
    return
  }
  print('warn', 'answer y or n')
}

function render(): void {
  if (!auth.isAuthenticated) {
    print('warn', 'login required')
    print('muted', 'commands    login')
    return
  }
  if (failure.value) {
    printFailure()
    return
  }
  if (!auth.canIssueTokens) {
    printNotPermitted()
    return
  }
  printRequest()
}

onMounted(render)

// The consent text must never lag behind the query it describes. A same-route
// query change reuses this component, so re-render when the request changes.
watch(parsed, () => {
  if (busy.value) {
    return
  }
  lines.value = []
  render()
})

// The router guard only runs on navigation. A session can be revoked or expire
// while the user is reading the consent screen; send them through login and
// back to this exact request.
watch(
  () => auth.status,
  (status) => {
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

onBeforeUnmount(() => {
  if (redirectTimer !== undefined) {
    window.clearTimeout(redirectTimer)
  }
})
</script>

<template>
  <TerminalShell
    ref="shell"
    prompt="authorize>"
    placeholder="y / n"
    :disabled="busy"
    :right="request?.destination.hostname ?? 'oauth'"
    label="Authorization response"
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

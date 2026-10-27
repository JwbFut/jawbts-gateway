import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { STORAGE_KEYS } from '@/config/app'
import { NetworkError } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import type { SessionInfo, UserProfile } from '@/types/api'

const api = vi.hoisted(() => ({
  login: vi.fn(),
  completeGithubLogin: vi.fn(),
  refresh: vi.fn(),
  getProfile: vi.fn(),
  updateEmail: vi.fn(),
  listSessions: vi.fn(),
  issueToken: vi.fn(),
  confirmEmail: vi.fn(),
  revokeSession: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, jawbtsApi: api }
})

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) ?? null) : null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

type StorageListener = (event: StorageEvent) => void

let local: MemoryStorage
let session: MemoryStorage
let windowListeners: Map<string, StorageListener>

function installWindow(): void {
  local = new MemoryStorage()
  session = new MemoryStorage()
  windowListeners = new Map()

  const fakeWindow = {
    localStorage: local,
    sessionStorage: session,
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    addEventListener: vi.fn((type: string, listener: StorageListener) => {
      windowListeners.set(type, listener)
    }),
    removeEventListener: vi.fn(),
    location: { assign: vi.fn() },
  }
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
  }

  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('navigator', { locks: undefined })
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function makeJwt(sub: string, sid: string): string {
  const now = Math.floor(Date.now() / 1000)
  return [
    b64url({ alg: 'RS256', typ: 'JWT', kid: 'test' }),
    b64url({
      iss: 'jawbts-api',
      sub,
      sid,
      scope: ['api', 'issue_tokens'],
      iat: now,
      exp: now + 3600,
    }),
    'signature',
  ].join('.')
}

function profile(id: number, name: string): UserProfile {
  return {
    id,
    name,
    githubId: String(1000 + id),
    permissions: ['issue_tokens'],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    email: `${name}@example.com`,
  }
}

const ALICE = profile(1, 'alice')
const BOB = profile(2, 'bob')

function sessionBlob(options: {
  sub?: string
  sid?: string
  refreshToken?: string
  epoch?: number
} = {}) {
  const now = Date.now()
  return {
    v: 1,
    refreshToken: options.refreshToken ?? 'R1',
    refreshTokenExpiresAt: new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString(),
    accessToken: makeJwt(options.sub ?? 'alice', options.sid ?? 's-refresh-1'),
    accessTokenExpiresAt: now + 60 * 60 * 1000,
    scope: ['api', 'issue_tokens'],
    epoch: options.epoch ?? 0,
  }
}

function seedSession(options: Parameters<typeof sessionBlob>[0] = {}): void {
  local.setItem(STORAGE_KEYS.session, JSON.stringify(sessionBlob(options)))
}

async function init(): Promise<ReturnType<typeof useAuthStore>> {
  const auth = useAuthStore()
  await auth.initialize()
  await vi.waitFor(() => {
    expect(auth.status).toBe('authenticated')
    expect(auth.profile?.name).toBe('alice')
  })
  return auth
}

beforeEach(() => {
  installWindow()
  setActivePinia(createPinia())
  for (const spy of Object.values(api)) {
    spy.mockReset()
  }
  api.getProfile.mockResolvedValue(ALICE)
})

describe('profile identity', () => {
  it('clears the old profile and force-loads the new account after a login', async () => {
    seedSession()
    const auth = await init()
    expect(auth.profile?.name).toBe('alice')

    api.completeGithubLogin.mockResolvedValue({
      refreshToken: 'R-new',
      sessionId: 's-login-2',
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      expiresIn: 24 * 60 * 60,
    })
    api.refresh.mockResolvedValue({
      token: makeJwt('bob', 's-refresh-2'),
      tokenType: 'Bearer',
      alg: 'RS256',
      kid: 'test',
      scope: ['api'],
      expiresIn: 3600,
      refreshToken: 'R2',
      refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    })
    api.getProfile.mockResolvedValue(BOB)

    const target = await auth.completeGithubLogin('code', 'state')
    expect(target).toBe('/account')
    expect(api.refresh).toHaveBeenCalledWith('R-new')
    expect(auth.profile?.name).toBe('bob')
    const stored = JSON.parse(local.getItem(STORAGE_KEYS.session) ?? '{}')
    expect(stored.refreshToken).toBe('R2')
  })

  it('drops the cached profile when another tab adopts a different account', async () => {
    seedSession()
    const auth = await init()
    const listener = windowListeners.get('storage')
    expect(listener).toBeDefined()

    listener?.({
      key: STORAGE_KEYS.session,
      newValue: JSON.stringify(sessionBlob({ sub: 'bob', sid: 's-refresh-2', refreshToken: 'R2' })),
    } as StorageEvent)

    expect(auth.status).toBe('authenticated')
    expect(auth.profile).toBeNull()
    expect(auth.username).toBe('bob')
  })
})

describe('logout', () => {
  it('reports a failed revocation, still clears the device, and bumps the epoch', async () => {
    seedSession()
    const auth = await init()
    api.revokeSession.mockRejectedValue(new NetworkError('offline'))

    const result = await auth.logout()

    expect(result.revoked).toBe(false)
    expect(result.error).toContain('offline')
    expect(auth.status).toBe('anonymous')
    expect(local.getItem(STORAGE_KEYS.session)).toBeNull()
    expect(local.getItem(STORAGE_KEYS.logoutEpoch)).toBe('1')
    expect(api.revokeSession).toHaveBeenCalledWith(expect.any(String), 's-refresh-1')
  })

  it('revokes the current session by id and reports success', async () => {
    seedSession()
    const auth = await init()
    api.revokeSession.mockResolvedValue({ revoked: true })

    const result = await auth.logout()

    expect(result).toEqual({ revoked: true, error: null })
    expect(auth.status).toBe('anonymous')
    expect(api.revokeSession).toHaveBeenCalledWith(expect.any(String), 's-refresh-1')
  })

  it('signs out locally when another tab bumps the logout epoch', async () => {
    seedSession()
    const auth = await init()
    const listener = windowListeners.get('storage')
    expect(listener).toBeDefined()

    listener?.({
      key: STORAGE_KEYS.logoutEpoch,
      newValue: '1',
    } as StorageEvent)

    expect(auth.status).toBe('anonymous')
    expect(local.getItem(STORAGE_KEYS.session)).toBeNull()
  })
})

describe('revokeSession', () => {
  it('ends the local session when a login parent id is revoked', async () => {
    seedSession()
    const auth = await init()
    api.revokeSession.mockResolvedValue({ revoked: true })
    api.listSessions.mockResolvedValue({ sessions: [] })

    const result = await auth.revokeSession('s-login-1')

    expect(result.wasCurrent).toBe(true)
    expect(auth.status).toBe('anonymous')
    expect(api.revokeSession).toHaveBeenCalledWith(expect.any(String), 's-login-1')
    expect(api.listSessions).toHaveBeenCalled()
  })

  it('leaves the local session alone when a delegated id is revoked', async () => {
    seedSession()
    const auth = await init()
    api.revokeSession.mockResolvedValue({ revoked: true })
    const currentSession: SessionInfo = {
      id: 's-refresh-1',
      type: 'REFRESH_TOKEN',
      permissions: [],
      label: null,
      parentId: 's-login-1',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      createdAt: new Date().toISOString(),
    }
    api.listSessions.mockResolvedValue({ sessions: [currentSession] })

    const result = await auth.revokeSession('s-delegated-1')

    expect(result.wasCurrent).toBe(false)
    expect(auth.status).toBe('authenticated')
  })

  it('skips the follow-up list read when checkCurrent is false', async () => {
    seedSession()
    const auth = await init()
    api.revokeSession.mockResolvedValue({ revoked: true })

    const result = await auth.revokeSession('s-delegated-1', { checkCurrent: false })

    expect(result.wasCurrent).toBe(false)
    expect(api.listSessions).not.toHaveBeenCalled()
  })
})

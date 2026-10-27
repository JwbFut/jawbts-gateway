import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { DEFAULT_AUTHENTICATED_PATH, MAX_TIMER_DELAY_MS, REFRESH_LOCK_NAME, STORAGE_KEYS } from '@/config/app'
import { jawbtsApi } from '@/lib/api'
import {
  describeError,
  isApiError,
  isDefinitiveAuthFailure,
  isNetworkError,
  isTokenExpiredError,
} from '@/lib/errors'
import { decodeJwt } from '@/lib/jwt'
import { safeInternalPath } from '@/lib/navigation'
import type { IssuedToken, RefreshResult, SessionList, UserProfile } from '@/types/api'

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated' | 'unavailable'
export type SessionLossReason = 'expired' | 'revoked' | 'missing' | 'unavailable' | null

/** How long an access token must remain valid before we reuse it on demand. */
const ACCESS_TOKEN_MIN_TTL_MS = 20_000
/**
 * How early the scheduled refresh should run for a fresh 10-minute token.
 * Kept separate from the on-demand minimum: a full page load with 30s left
 * should still be allowed to use the token instead of forcing an immediate
 * refresh (and a possible sign-out if that refresh is ambiguous).
 */
const AUTO_REFRESH_LEAD_MS = 60_000
/**
 * Same threshold while holding the rotation lock. If another tab already
 * rotated to a fresh token we adopt it; otherwise this tab rotates, so a
 * scheduled refresh renews the token instead of reusing a nearly dead one.
 */
const ACCESS_TOKEN_LOCK_MIN_TTL_MS = ACCESS_TOKEN_MIN_TTL_MS
/** Retry delay after a pre-rotation API failure (alert/signing/rate limit). */
const AUTO_REFRESH_RETRY_MS = 10_000
/** Never schedule an automatic refresh tighter than this. */
const AUTO_REFRESH_MIN_DELAY_MS = 5_000
/**
 * Fallback cross-tab lease (used when Web Locks is unavailable). This must be
 * longer than the refresh request timeout: otherwise a slow but successful
 * refresh can be stolen by another tab, which then replays the single-use
 * token and gets the whole session revoked.
 */
const REFRESH_LEASE_TTL_MS = 90_000
const REFRESH_LEASE_HEARTBEAT_MS = 5_000
const REFRESH_LEASE_WAIT_MS = 30_000
const REFRESH_LEASE_POLL_MIN_MS = 80

/**
 * The single localStorage value shared by every tab. Keeping the access token,
 * its expiry and the refresh token in one JSON blob makes each rotation a
 * single atomic write. Concurrent tabs then either observe the old blob (and
 * rotate under the Web Locks mutex) or the new blob (and adopt it without
 * rotating again).
 *
 * The refresh token is the real long-lived credential. The short-lived access
 * token is stored next to it so a second tab does not have to rotate the
 * single-use refresh token just to obtain its own JWT.
 */
interface StoredSession {
  v: 1
  refreshToken: string
  refreshTokenExpiresAt: string | null
  accessToken: string
  accessTokenExpiresAt: number
  scope: string[]
  /**
   * Logout epoch captured when the session was written. A write made under an
   * older epoch is discarded, so a refresh that finishes after a logout can
   * never resurrect the session.
   */
  epoch: number
}

export class AuthRequiredError extends Error {
  constructor(message = 'No refresh token is available.') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T>
}

function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const value = parsed as Partial<StoredSession>
    if (
      value.v !== 1 ||
      typeof value.refreshToken !== 'string' ||
      !value.refreshToken ||
      typeof value.accessToken !== 'string' ||
      typeof value.accessTokenExpiresAt !== 'number' ||
      !Number.isFinite(value.accessTokenExpiresAt) ||
      !Array.isArray(value.scope)
    ) {
      return null
    }
    return {
      v: 1,
      refreshToken: value.refreshToken,
      refreshTokenExpiresAt:
        typeof value.refreshTokenExpiresAt === 'string' ? value.refreshTokenExpiresAt : null,
      accessToken: value.accessToken,
      accessTokenExpiresAt: value.accessTokenExpiresAt,
      scope: value.scope.filter((scope): scope is string => typeof scope === 'string'),
      epoch:
        typeof value.epoch === 'number' && Number.isFinite(value.epoch) && value.epoch > 0
          ? Math.floor(value.epoch)
          : 0,
    }
  } catch {
    return null
  }
}

function accessExpiryFrom(result: RefreshResult): number {
  const claims = decodeJwt(result.token)
  if (typeof claims?.exp === 'number' && Number.isFinite(claims.exp)) {
    return claims.exp * 1000
  }
  // A malformed success response must not produce NaN: `setTimeout(NaN)` is
  // zero and would turn the refresh timer into a tight loop.
  const seconds =
    Number.isFinite(result.expiresIn) && result.expiresIn > 0 ? result.expiresIn : 60
  return Date.now() + seconds * 1000
}

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('unknown')
  const accessToken = ref<string | null>(null)
  const accessExpiresAt = ref<number | null>(null)
  const scopes = ref<string[]>([])
  const refreshExpiresAt = ref<string | null>(null)
  const profile = ref<UserProfile | null>(null)
  const profileLoading = ref(false)
  const profileError = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const sessionLossReason = ref<SessionLossReason>(null)
  const signingOut = ref(false)
  const initialized = ref(false)

  let currentSession: StoredSession | null = null
  let initializePromise: Promise<void> | null = null
  let refreshPromise: Promise<string> | null = null
  let profilePromise: Promise<UserProfile | null> | null = null
  let profileRequestId = 0
  let storageListenerAttached = false
  let visibilityListenerAttached = false
  let refreshTimer: number | undefined
  /** Last observed logout epoch; shared via localStorage with every tab. */
  let currentEpoch = 0

  // ---------------------------------------------------------------------------
  // Logout epoch
  // ---------------------------------------------------------------------------

  function readLogoutEpoch(): number {
    if (typeof window === 'undefined') {
      return currentEpoch
    }
    try {
      const value = Number(window.localStorage.getItem(STORAGE_KEYS.logoutEpoch) ?? 0)
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
    } catch {
      return currentEpoch
    }
  }

  function syncLogoutEpoch(): number {
    const next = readLogoutEpoch()
    if (next > currentEpoch) {
      currentEpoch = next
    }
    return currentEpoch
  }

  /**
   * Marks a sign-out for every tab. Called before a session is cleared so an
   * in-flight refresh in any tab can detect that it must discard its result.
   */
  function bumpLogoutEpoch(): number {
    const next = Math.max(currentEpoch, readLogoutEpoch()) + 1
    currentEpoch = next
    if (typeof window === 'undefined') {
      return next
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.logoutEpoch, String(next))
    } catch {
      // Keep the in-memory epoch: this tab still behaves correctly.
    }
    return next
  }

  const isAuthenticated = computed(() => status.value === 'authenticated')
  const currentSessionId = computed(() => {
    const sid = decodeJwt(accessToken.value)?.sid
    return typeof sid === 'string' ? sid : null
  })
  const username = computed(() => {
    const claims = decodeJwt(accessToken.value)
    const sub = typeof claims?.sub === 'string' ? claims.sub : null
    return profile.value?.name ?? sub
  })
  const email = computed(() => profile.value?.email ?? null)
  const emailChangePending = computed(
    () => profile.value !== null && typeof profile.value.email !== 'string',
  )
  const permissions = computed(() => profile.value?.permissions ?? [])
  const canIssueTokens = computed(() => scopes.value.includes('issue_tokens'))

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  function readStoredSession(): StoredSession | null {
    syncLogoutEpoch()
    if (typeof window === 'undefined') {
      return currentSession && currentSession.epoch >= currentEpoch ? currentSession : null
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.session)
      const parsed = parseStoredSession(raw)
      if (parsed) {
        if (parsed.epoch < currentEpoch) {
          // Written before a logout observed by another tab; do not revive it.
          window.localStorage.removeItem(STORAGE_KEYS.session)
          currentSession = null
          return null
        }
        currentSession = parsed
        return parsed
      }
      if (raw !== null) {
        window.localStorage.removeItem(STORAGE_KEYS.session)
      }
    } catch {
      // Storage can be unavailable (privacy modes, quota, disabled cookies).
      // Fall back to the in-memory session.
    }
    if (currentSession && currentSession.epoch < currentEpoch) {
      currentSession = null
    }
    return currentSession
  }

  function writeStoredSession(session: StoredSession): void {
    if (session.epoch < currentEpoch) {
      return
    }
    currentSession = session
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session))
    } catch {
      // Keep the in-memory session: the tab keeps working until reload.
    }
  }

  function removeStoredSession(): void {
    currentSession = null
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.removeItem(STORAGE_KEYS.session)
    } catch {
      // Ignore.
    }
  }

  function isAccessTokenUsable(session: StoredSession, minTtlMs: number): boolean {
    return Boolean(
      session.accessToken &&
        Number.isFinite(session.accessTokenExpiresAt) &&
        session.accessTokenExpiresAt - Date.now() > minTtlMs,
    )
  }

  function adoptSession(session: StoredSession): void {
    if (session.epoch < currentEpoch) {
      // A stale write from before a logout; ignore instead of resurrecting.
      return
    }
    currentEpoch = Math.max(currentEpoch, session.epoch)
    currentSession = session
    // The cached profile belongs to the previous session unless the JWT `sub`
    // still matches. Without this check, switching accounts would keep showing
    // (and acting with) the previous user's identity.
    const subject = decodeJwt(session.accessToken)?.sub
    if (profile.value && (typeof subject !== 'string' || profile.value.name !== subject)) {
      profile.value = null
      profileError.value = null
    }
    accessToken.value = session.accessToken || null
    accessExpiresAt.value = session.accessToken
      ? session.accessTokenExpiresAt
      : null
    scopes.value = [...session.scope]
    refreshExpiresAt.value = session.refreshTokenExpiresAt
    status.value = 'authenticated'
    sessionLossReason.value = null
    lastError.value = null
    scheduleAutoRefresh()
  }

  function clearSessionState(reason: SessionLossReason = null): void {
    clearAutoRefresh()
    accessToken.value = null
    accessExpiresAt.value = null
    scopes.value = []
    refreshExpiresAt.value = null
    profile.value = null
    profileError.value = null
    profileLoading.value = false
    profilePromise = null
    sessionLossReason.value = reason
    if (reason === null) {
      lastError.value = null
    }
  }

  function forgetSession(reason: SessionLossReason): void {
    // Signal every tab before clearing: any refresh response that started under
    // the old epoch must be discarded rather than written back.
    bumpLogoutEpoch()
    removeStoredSession()
    clearSessionState(reason)
    status.value = reason === 'unavailable' ? 'unavailable' : 'anonymous'
  }

  function attachStorageListener(): void {
    attachVisibilityListener()
    if (storageListenerAttached || typeof window === 'undefined') {
      return
    }
    storageListenerAttached = true
    syncLogoutEpoch()
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEYS.logoutEpoch) {
        const next = Number(event.newValue)
        if (Number.isFinite(next) && next > currentEpoch) {
          currentEpoch = Math.floor(next)
          // Another tab signed out; drop this tab's session too, unless this
          // tab is itself in the middle of signing out.
          if (!signingOut.value) {
            removeStoredSession()
            clearSessionState('revoked')
            status.value = 'anonymous'
          }
        }
        return
      }
      if (signingOut.value) {
        return
      }
      if (event.key === null || event.key === STORAGE_KEYS.session) {
        if (event.key === null || event.newValue === null) {
          // Another tab signed out (or storage was cleared).
          removeStoredSession()
          clearSessionState('revoked')
          status.value = 'anonymous'
          return
        }
        const next = parseStoredSession(event.newValue)
        if (!next || next.epoch < currentEpoch) {
          return
        }
        // Another tab refreshed, or completed a login; adopt its session
        // instead of rotating the single-use refresh token again.
        adoptSession(next)
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Cross-tab refresh mutex
  // ---------------------------------------------------------------------------

  interface StoredLease {
    owner: string
    expiresAt: number
  }

  function parseLease(raw: string | null): StoredLease | null {
    if (!raw) {
      return null
    }
    try {
      const value = JSON.parse(raw) as Partial<StoredLease>
      if (
        typeof value.owner !== 'string' ||
        typeof value.expiresAt !== 'number' ||
        !Number.isFinite(value.expiresAt)
      ) {
        return null
      }
      return { owner: value.owner, expiresAt: value.expiresAt }
    } catch {
      return null
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms)
    })
  }

  /**
   * Best-effort mutex for browsers without `navigator.locks`. The lease is
   * renewed while the operation runs, so a slow refresh cannot be stolen by a
   * waiting tab; a crashed holder is recovered after the TTL.
   */
  async function withStorageLease<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof window === 'undefined') {
      return operation()
    }
    const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const deadline = Date.now() + REFRESH_LEASE_WAIT_MS
    while (Date.now() < deadline) {
      let currentRaw: string | null
      try {
        currentRaw = window.localStorage.getItem(STORAGE_KEYS.refreshLease)
      } catch {
        // Storage unavailable: the in-memory single-flight is all we have.
        return operation()
      }
      const current = parseLease(currentRaw)
      if (!current || current.expiresAt <= Date.now()) {
        const lease: StoredLease = {
          owner,
          expiresAt: Date.now() + REFRESH_LEASE_TTL_MS,
        }
        try {
          window.localStorage.setItem(STORAGE_KEYS.refreshLease, JSON.stringify(lease))
        } catch {
          return operation()
        }
        let confirmed: StoredLease | null = null
        try {
          confirmed = parseLease(window.localStorage.getItem(STORAGE_KEYS.refreshLease))
        } catch {
          confirmed = null
        }
        if (confirmed?.owner === owner) {
          const heartbeat = window.setInterval(() => {
            try {
              const raw = window.localStorage.getItem(STORAGE_KEYS.refreshLease)
              if (parseLease(raw)?.owner === owner) {
                window.localStorage.setItem(
                  STORAGE_KEYS.refreshLease,
                  JSON.stringify({ owner, expiresAt: Date.now() + REFRESH_LEASE_TTL_MS }),
                )
              }
            } catch {
              // Ignore: the operation still holds the lock in this tab.
            }
          }, REFRESH_LEASE_HEARTBEAT_MS)
          try {
            return await operation()
          } finally {
            window.clearInterval(heartbeat)
            try {
              const raw = window.localStorage.getItem(STORAGE_KEYS.refreshLease)
              if (parseLease(raw)?.owner === owner) {
                window.localStorage.removeItem(STORAGE_KEYS.refreshLease)
              }
            } catch {
              // Ignore.
            }
          }
        }
      }
      await sleep(REFRESH_LEASE_POLL_MIN_MS + Math.random() * 120)
    }
    throw new Error('Could not acquire the refresh lock; try again.')
  }

  async function withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined') {
      const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks
      if (locks?.request) {
        return locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, operation)
      }
    }
    return withStorageLease(operation)
  }

  function clearAutoRefresh(): void {
    if (typeof window !== 'undefined' && refreshTimer !== undefined) {
      window.clearTimeout(refreshTimer)
    }
    refreshTimer = undefined
  }

  function scheduleAutoRefresh(delayMs?: number): void {
    clearAutoRefresh()
    if (
      typeof window === 'undefined' ||
      status.value !== 'authenticated' ||
      signingOut.value ||
      accessExpiresAt.value === null ||
      !Number.isFinite(accessExpiresAt.value)
    ) {
      return
    }
    const remaining = accessExpiresAt.value - Date.now()
    const lead = Math.min(
      AUTO_REFRESH_LEAD_MS,
      Math.max(AUTO_REFRESH_MIN_DELAY_MS, remaining - ACCESS_TOKEN_MIN_TTL_MS),
    )
    const rawDelay = delayMs ?? remaining - lead
    const boundedDelay = Number.isFinite(rawDelay)
      ? rawDelay
      : AUTO_REFRESH_MIN_DELAY_MS
    const delay = Math.min(
      Math.max(AUTO_REFRESH_MIN_DELAY_MS, boundedDelay),
      MAX_TIMER_DELAY_MS,
    )
    refreshTimer = window.setTimeout(() => {
      void runAutoRefresh()
    }, delay)
  }

  async function runAutoRefresh(): Promise<void> {
    refreshTimer = undefined
    if (signingOut.value || status.value !== 'authenticated') {
      return
    }
    try {
      await refreshAccessToken()
    } catch (error) {
      if (status.value !== 'authenticated') {
        return
      }
      lastError.value = describeError(error)
      // Only retry failures the API raises before spending the single-use
      // refresh token. Automatically replaying a timed-out/5xx refresh can
      // hit the API's reuse detector and revoke the whole session, which is
      // exactly what a "random" sign-out looks like.
      if (
        isApiError(error) &&
        (error.code === 10012 || error.code === 10014 || error.code === 10016)
      ) {
        scheduleAutoRefresh(AUTO_REFRESH_RETRY_MS)
      }
    }
  }

  function attachVisibilityListener(): void {
    if (visibilityListenerAttached || typeof document === 'undefined') {
      return
    }
    visibilityListenerAttached = true
    document.addEventListener('visibilitychange', () => {
      if (
        !signingOut.value &&
        document.visibilityState === 'visible' &&
        status.value === 'authenticated'
      ) {
        void ensureAccessToken().catch(() => undefined)
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Refresh + access token
  // ---------------------------------------------------------------------------

  async function runRefresh(
    rejectedToken?: string,
    options: { allowWhileSigningOut?: boolean } = {},
  ): Promise<string> {
    const token = await withRefreshLock(async () => {
      if (signingOut.value && !options.allowWhileSigningOut) {
        throw new AuthRequiredError('Signing out.')
      }
      const epoch = syncLogoutEpoch()
      const shared = readStoredSession()
      if (
        shared &&
        shared.accessToken !== rejectedToken &&
        isAccessTokenUsable(shared, ACCESS_TOKEN_LOCK_MIN_TTL_MS)
      ) {
        adoptSession(shared)
        return shared.accessToken
      }
      const presented = shared?.refreshToken ?? currentSession?.refreshToken ?? null
      if (!presented) {
        throw new AuthRequiredError()
      }
      const result = await jawbtsApi.refresh(presented)
      if (
        (signingOut.value && !options.allowWhileSigningOut) ||
        readLogoutEpoch() !== epoch
      ) {
        // A logout happened while the single-use token was being spent. Do not
        // write the rotated credential back into storage.
        throw new AuthRequiredError('Session changed while refreshing.')
      }
      const session: StoredSession = {
        v: 1,
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt ?? null,
        accessToken: result.token,
        accessTokenExpiresAt: accessExpiryFrom(result),
        scope: Array.isArray(result.scope) ? result.scope : [],
        epoch,
      }
      // Persist before returning so a concurrent tab can adopt this rotation
      // instead of spending the same single-use token.
      writeStoredSession(session)
      adoptSession(session)
      return session.accessToken
    })
    return token
  }

  async function refreshAccessToken(
    rejectedToken?: string,
    options: { allowWhileSigningOut?: boolean } = {},
  ): Promise<string> {
    if (refreshPromise) {
      const token = await refreshPromise
      if (rejectedToken !== undefined && token === rejectedToken) {
        return refreshAccessToken(rejectedToken, options)
      }
      return token
    }
    refreshPromise = (async () => {
      try {
        return await runRefresh(rejectedToken, options)
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          forgetSession('missing')
          throw error
        }
        if (isDefinitiveAuthFailure(error)) {
          forgetSession(isTokenExpiredError(error) ? 'expired' : 'revoked')
          throw error
        }
        // Network or server failure: keep the stored session so the user can
        // retry instead of being silently logged out.
        lastError.value = describeError(error)
        if (status.value !== 'authenticated') {
          status.value = 'unavailable'
        }
        throw error
      } finally {
        refreshPromise = null
      }
    })()
    return refreshPromise
  }

  async function ensureAccessToken(
    options: {
      forceRefresh?: boolean
      rejectedToken?: string
      allowWhileSigningOut?: boolean
    } = {},
  ): Promise<string> {
    if (signingOut.value && !options.allowWhileSigningOut) {
      throw new AuthRequiredError('Signing out.')
    }
    attachStorageListener()
    if (!options.forceRefresh) {
      if (
        accessToken.value &&
        accessExpiresAt.value !== null &&
        accessExpiresAt.value - Date.now() > ACCESS_TOKEN_MIN_TTL_MS
      ) {
        return accessToken.value
      }
      const shared = readStoredSession()
      if (shared && isAccessTokenUsable(shared, ACCESS_TOKEN_MIN_TTL_MS)) {
        adoptSession(shared)
        return shared.accessToken
      }
    }
    return refreshAccessToken(
      options.forceRefresh ? options.rejectedToken : undefined,
      { allowWhileSigningOut: options.allowWhileSigningOut },
    )
  }

  /**
   * Runs an authenticated request and retries once if the API says the JWT
   * expired. A definitive 10005/10006 after that retry ends the local session.
   */
  async function withAuth<T>(operation: (token: string) => Promise<T>): Promise<T> {
    const token = await ensureAccessToken()
    try {
      return await operation(token)
    } catch (error) {
      if (isTokenExpiredError(error)) {
        try {
          const freshToken = await ensureAccessToken({
            forceRefresh: true,
            rejectedToken: token,
          })
          return await operation(freshToken)
        } catch (retryError) {
          if (isDefinitiveAuthFailure(retryError)) {
            forgetSession(isTokenExpiredError(retryError) ? 'expired' : 'revoked')
          }
          throw retryError
        }
      }
      if (isDefinitiveAuthFailure(error)) {
        forgetSession(isTokenExpiredError(error) ? 'expired' : 'revoked')
      }
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async function initialize(): Promise<void> {
    attachStorageListener()
    if (initialized.value) {
      return
    }
    if (initializePromise) {
      return initializePromise
    }
    initializePromise = (async () => {
      const shared = readStoredSession()
      if (!shared) {
        status.value = 'anonymous'
        initialized.value = true
        return
      }
      if (isAccessTokenUsable(shared, ACCESS_TOKEN_MIN_TTL_MS)) {
        adoptSession(shared)
        initialized.value = true
        void loadProfile().catch(() => undefined)
        return
      }
      try {
        await refreshAccessToken()
        initialized.value = true
        void loadProfile().catch(() => undefined)
      } catch (error) {
        initialized.value = true
        if (isApiError(error) && isDefinitiveAuthFailure(error)) {
          status.value = 'anonymous'
        } else if (error instanceof AuthRequiredError) {
          status.value = 'anonymous'
        } else if (isNetworkError(error) || (isApiError(error) && error.status >= 500)) {
          status.value = 'unavailable'
          lastError.value = describeError(error)
        } else {
          status.value = 'anonymous'
        }
      }
    })().finally(() => {
      initializePromise = null
    })
    return initializePromise
  }

  /** Retry a session restoration that failed because the API was unavailable. */
  async function retrySession(): Promise<boolean> {
    initialized.value = false
    status.value = 'unknown'
    lastError.value = null
    await initialize()
    return isAuthenticated.value
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  async function loadProfile(options: { force?: boolean } = {}): Promise<UserProfile | null> {
    if (!options.force && profile.value) {
      return profile.value
    }
    if (!options.force && profilePromise) {
      return profilePromise
    }
    profileLoading.value = true
    profileError.value = null
    const requestId = ++profileRequestId
    const request = (async () => {
      try {
        const user = await withAuth((token) => jawbtsApi.getProfile(token))
        // The session may have changed (logout or another account) while the
        // request was in flight. Never attach a profile that no longer matches
        // the JWT that is actually in use.
        const subject = decodeJwt(accessToken.value)?.sub
        if (typeof subject !== 'string' || subject !== user.name) {
          return null
        }
        profile.value = user
        return user
      } catch (error) {
        if (requestId === profileRequestId) {
          profileError.value = describeError(error)
        }
        throw error
      } finally {
        if (requestId === profileRequestId) {
          profileLoading.value = false
          profilePromise = null
        }
      }
    })()
    profilePromise = request
    return request
  }

  async function updateEmail(nextEmail: string): Promise<UserProfile> {
    const user = await withAuth((token) => jawbtsApi.updateEmail(token, nextEmail))
    profile.value = user
    profileError.value = null
    return user
  }

  async function listSessions(): Promise<SessionList> {
    return withAuth((token) => jawbtsApi.listSessions(token))
  }

  async function issueToken(scope: string[], label?: string): Promise<IssuedToken> {
    return withAuth((token) => jawbtsApi.issueToken(token, scope, label))
  }

  /**
   * Revokes one of the user's sessions by the id shown by the `sessions`
   * command. The current refresh child is recognised directly; for any other
   * id (including a login parent) the store confirms against the live list
   * before deciding whether this device just signed itself out.
   * `checkCurrent: false` skips that follow-up read when the caller knows the
   * target cannot be the current login.
   */
  async function revokeSession(
    sessionId: string,
    options: { checkCurrent?: boolean } = {},
  ): Promise<{ wasCurrent: boolean }> {
    const id = sessionId.trim()
    if (!id) {
      throw new Error('Enter a session id.')
    }
    await withAuth((token) => jawbtsApi.revokeSession(token, id))
    const currentSid = currentSessionId.value
    let wasCurrent = currentSid !== null && id === currentSid
    if (!wasCurrent && options.checkCurrent !== false && currentSid !== null) {
      // The user may have revoked the parent GITHUB_LOGIN row, which cascades
      // to the current REFRESH_TOKEN child. Confirm against the live list.
      try {
        const list = await withAuth((token) => jawbtsApi.listSessions(token))
        wasCurrent = !list.sessions.some(
          (session) => session.type === 'REFRESH_TOKEN' && session.id === currentSid,
        )
      } catch {
        // The revoke itself succeeded; a failed follow-up read must not turn it
        // into an error. If the session is already gone, withAuth has cleared
        // the local state and `status` is no longer authenticated.
        wasCurrent = status.value !== 'authenticated'
      }
    }
    if (wasCurrent) {
      forgetSession('revoked')
    }
    return { wasCurrent }
  }

  // ---------------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------------

  function rememberReturnTo(returnTo: string): void {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.sessionStorage.setItem(STORAGE_KEYS.returnTo, safeInternalPath(returnTo))
    } catch {
      // sessionStorage unavailable: callback falls back to /account.
    }
  }

  function consumeReturnTo(): string {
    if (typeof window === 'undefined') {
      return DEFAULT_AUTHENTICATED_PATH
    }
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEYS.returnTo)
      window.sessionStorage.removeItem(STORAGE_KEYS.returnTo)
      return safeInternalPath(stored)
    } catch {
      return DEFAULT_AUTHENTICATED_PATH
    }
  }

  async function startGithubLogin(usernameToUse: string, returnTo: string): Promise<void> {
    const trimmed = usernameToUse.trim()
    if (!trimmed) {
      throw new Error('Enter your GitHub username.')
    }
    rememberReturnTo(returnTo)
    try {
      const result = await jawbtsApi.login(trimmed)
      const authUrl = new URL(result.authUrl)
      if (authUrl.protocol !== 'https:' || authUrl.hostname !== 'github.com') {
        throw new Error('The API returned an unexpected GitHub authorization URL.')
      }
      window.location.assign(authUrl.toString())
    } catch (error) {
      // Do not leave a stale return target behind if the login never started.
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(STORAGE_KEYS.returnTo)
        } catch {
          // Ignore.
        }
      }
      throw error
    }
  }

  /**
   * Finishes GitHub OAuth. The callback returns a refresh token only, so this
   * immediately spends it on `/auth/refresh` to obtain the first JWT.
   */
  async function completeGithubLogin(code: string, oauthState: string): Promise<string> {
    const epoch = syncLogoutEpoch()
    const result = await jawbtsApi.completeGithubLogin(code, oauthState)
    if (signingOut.value || readLogoutEpoch() !== epoch) {
      throw new AuthRequiredError('Signed out while completing the login.')
    }
    // A login is an identity change: never keep the previous account's profile
    // while the new token is being exchanged.
    profile.value = null
    profileError.value = null
    const pending: StoredSession = {
      v: 1,
      refreshToken: result.refreshToken,
      refreshTokenExpiresAt: result.expiresAt ?? null,
      accessToken: '',
      accessTokenExpiresAt: 0,
      scope: [],
      epoch,
    }
    writeStoredSession(pending)
    adoptSession(pending)
    try {
      await refreshAccessToken()
    } catch (error) {
      if (isDefinitiveAuthFailure(error)) {
        forgetSession(isTokenExpiredError(error) ? 'expired' : 'revoked')
      } else {
        // The callback already consumed the OAuth state and returned a refresh
        // token. A network/5xx failure must not throw that credential away:
        // keep it and let the user retry the refresh.
        status.value = 'unavailable'
        lastError.value = describeError(error)
      }
      initialized.value = true
      throw error
    }
    initialized.value = true
    await loadProfile({ force: true }).catch(() => undefined)
    return consumeReturnTo()
  }

  function validAccessToken(): string | null {
    return accessToken.value &&
      accessExpiresAt.value !== null &&
      accessExpiresAt.value > Date.now() + 1_000
      ? accessToken.value
      : null
  }

  async function logout(): Promise<{ revoked: boolean; error: string | null }> {
    if (signingOut.value) {
      return { revoked: false, error: null }
    }
    signingOut.value = true
    clearAutoRefresh()
    const session = readStoredSession()
    let revoked = false
    let revokeError: string | null = null
    let epochBumped = false
    try {
      if (session?.refreshToken) {
        // Prefer the already-valid JWT: refreshing just to revoke is both
        // slower and another chance for a single-use rotation to go wrong.
        let token = validAccessToken()
        if (!token) {
          try {
            token = await ensureAccessToken({ allowWhileSigningOut: true })
          } catch (error) {
            if (
              isApiError(error) &&
              (isTokenExpiredError(error) || error.code === 10002 || error.code === 10006)
            ) {
              // The refresh token itself is no longer usable: the session is
              // already dead as far as this device is concerned.
              revoked = true
            } else {
              revokeError = describeError(error)
            }
            token = null
          }
        }

        if (token) {
          try {
            await withRefreshLock(async () => {
              try {
                const access = validAccessToken() ?? token
                const sid = currentSessionId.value
                if (!sid) {
                  throw new Error(
                    'The current session id is unavailable; it could not be revoked.',
                  )
                }
                await jawbtsApi.revokeSession(access, sid)
                revoked = true
              } finally {
                // Signal the logout while still holding the lock so a refresh
                // waiting behind us discards its rotation instead of writing a
                // new session after the sign-out.
                if (!epochBumped) {
                  bumpLogoutEpoch()
                  epochBumped = true
                }
              }
            })
          } catch (error) {
            // 10000 means the session row is already gone; that is the desired
            // end state. Anything else (including a JWT 10005/10006) means the
            // server-side session may still be live.
            if (isApiError(error) && error.code === 10000) {
              revoked = true
            } else {
              revokeError = describeError(error)
            }
          }
        }
      }
    } finally {
      if (!epochBumped) {
        bumpLogoutEpoch()
      }
      removeStoredSession()
      clearSessionState(null)
      status.value = 'anonymous'
      initialized.value = true
      signingOut.value = false
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(STORAGE_KEYS.returnTo)
        } catch {
          // Ignore.
        }
      }
    }
    return { revoked, error: revokeError }
  }

  return {
    status,
    scopes,
    refreshExpiresAt,
    profile,
    profileLoading,
    profileError,
    lastError,
    sessionLossReason,
    isAuthenticated,
    currentSessionId,
    username,
    email,
    emailChangePending,
    permissions,
    canIssueTokens,
    initialize,
    retrySession,
    loadProfile,
    updateEmail,
    listSessions,
    issueToken,
    revokeSession,
    startGithubLogin,
    completeGithubLogin,
    logout,
  }
})

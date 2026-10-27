function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const fallbackApiBase = import.meta.env.DEV
  ? 'http://localhost:3000'
  : 'https://api.jawbts.org'

/** Base URL of jawbts-api. Baked into the bundle at build time. */
export const API_BASE_URL = withoutTrailingSlash(configuredApiBase || fallbackApiBase)

/**
 * Fail closed when a production build was baked with an unsafe API base.
 *
 * A production bundle that points at `http:` (or at a developer machine) sends
 * bearer and refresh tokens in plaintext or to the wrong host. Development is
 * looser so `http://localhost:3000` keeps working.
 */
export function validateApiBase(base: string, dev: boolean): void {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new Error(`VITE_API_BASE_URL must be an absolute URL, received "${base}".`)
  }
  if (url.protocol !== 'https:' && !(dev && url.protocol === 'http:')) {
    throw new Error(
      `VITE_API_BASE_URL must use HTTPS${dev ? ' (HTTP is allowed only in development)' : ''}.`,
    )
  }
  if (!dev && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(
      'VITE_API_BASE_URL points at a local development host in a production build.',
    )
  }
}

validateApiBase(API_BASE_URL, import.meta.env.DEV)

/** Human-readable name used in the header, titles and emails hints. */
export const SITE_NAME = import.meta.env.VITE_SITE_NAME?.trim() || 'Jawbts'

/**
 * Build hash shown in the terminal welcome banner. `vite.config.ts` injects the
 * commit hash from the hosting/CI environment (Vercel, GitHub Actions, GitLab)
 * or an explicit `VITE_BUILD_HASH`; local builds without that metadata use
 * "dev".
 */
export const BUILD_HASH =
  (import.meta.env.VITE_BUILD_HASH?.trim() ||
    (typeof __BUILD_HASH__ === 'string' && __BUILD_HASH__ ? __BUILD_HASH__ : 'dev')).slice(0, 7)

/**
 * Copyright/license line under the build hash. The repository is licensed
 * under GPL-3.0-only (see LICENSE); override with `VITE_LICENSE_NOTICE` only if
 * a deployment needs a different notice.
 */
export const LICENSE_NOTICE =
  import.meta.env.VITE_LICENSE_NOTICE?.trim() ||
  `(c) ${new Date().getFullYear()} ${SITE_NAME}. GNU General Public License v3.0`

/** Where a signed-in user lands by default. */
export const DEFAULT_AUTHENTICATED_PATH = '/account'

/**
 * Local storage keys. They are namespaced so a shared origin cannot collide
 * with another Jawbts frontend.
 */
export const STORAGE_KEYS = {
  /**
   * One atomic JSON blob: refresh token + current short-lived access token.
   * Shared by all tabs so they can coordinate single-use refresh rotation.
   */
  session: 'jawbts.gateway.session',
  returnTo: 'jawbts.gateway.return_to',
  /**
   * Monotonic logout counter. Every sign-out increments it; other tabs clear
   * their session when they observe the new value, and a refresh response that
   * started under an older epoch is discarded instead of resurrecting a
   * logged-out session.
   */
  logoutEpoch: 'jawbts.gateway.logout_epoch',
  /** Cross-tab refresh lease used when Web Locks is unavailable. */
  refreshLease: 'jawbts.gateway.refresh_lease',
} as const

/** The Web Locks name used to serialise refresh-token rotation across tabs. */
export const REFRESH_LOCK_NAME = 'jawbts.gateway.refresh-token-rotation'

/** Largest delay `setTimeout` accepts without overflowing to zero. */
export const MAX_TIMER_DELAY_MS = 2_147_000_000

/** Types for the jawbts-api JSON contract. */

/** Every jawbts-api response is wrapped in this envelope. */
export interface ApiEnvelope<T> {
  success: boolean
  code: number
  message: string
  data: T
}

export interface UserProfile {
  id: number
  name: string
  githubId: string
  permissions: string[]
  createdAt: string
  updatedAt: string
  /**
   * Present only while the account has an active, deliverable address.
   * jawbts-api deliberately omits it while an email change is pending.
   */
  email?: string
}

export interface LoginStart {
  authUrl: string
  /**
   * Seconds the pending OAuth state stays valid (currently 60). Absent on
   * older API builds, which allowed ten minutes.
   */
  stateExpiresIn?: number
}

export interface LoginComplete {
  refreshToken: string
  /**
   * The `REFRESH_TOKEN` login root created by the callback. It is also the
   * session id carried by the JWT `sid` after the first refresh.
   */
  sessionId: string
  tokenType: string
  expiresAt: string
  expiresIn: number
}

export interface RefreshResult {
  token: string
  tokenType: string
  alg: string
  kid: string
  scope: string[]
  expiresIn: number
  refreshToken: string
  refreshTokenExpiresAt: string
}

export interface IssuedToken {
  token: string
  tokenType: string
  alg: string
  kid: string
  scope: string[]
  label: string | null
  expiresIn: number
  tokenId: string
  refreshToken: string
  refreshTokenExpiresAt: string
}

export type SessionType = 'GITHUB_LOGIN' | 'REFRESH_TOKEN' | 'DELEGATED_TOKEN'

export interface SessionInfo {
  id: string
  type: SessionType
  permissions: string[]
  label: string | null
  /**
   * New logins are a single `REFRESH_TOKEN` root and leave this null. Older
   * logins are a `GITHUB_LOGIN` parent with a `REFRESH_TOKEN` child pointing
   * at it, and delegated tokens are their own roots.
   */
  parentId: string | null
  expiresAt: string
  createdAt: string
}

export interface SessionList {
  sessions: SessionInfo[]
}

export interface EmailConfirmResult {
  confirmed: boolean
  email: string
}

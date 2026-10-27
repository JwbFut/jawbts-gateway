import { API_BASE_URL } from '@/config/app'
import type {
  ApiEnvelope,
  EmailConfirmResult,
  IssuedToken,
  LoginComplete,
  LoginStart,
  RefreshResult,
  SessionList,
  UserProfile,
} from '@/types/api'

const DEFAULT_TIMEOUT_MS = 20_000

export class ApiError extends Error {
  readonly code: number | null
  readonly status: number
  readonly data: unknown
  readonly envelopeMessage: string | null

  constructor(
    code: number | null,
    status: number,
    data: unknown,
    envelopeMessage: string | null,
    message?: string,
  ) {
    super(message || envelopeMessage || 'The API request failed.')
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.data = data
    this.envelopeMessage = envelopeMessage
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string | null
  timeoutMs?: number
}

function buildUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

async function readEnvelope(response: Response): Promise<ApiEnvelope<unknown> | null> {
  const text = await response.text().catch(() => '')
  if (!text) {
    return null
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'success' in parsed &&
      typeof (parsed as ApiEnvelope<unknown>).success === 'boolean'
    ) {
      return parsed as ApiEnvelope<unknown>
    }
  } catch {
    // Fall through: the caller reports a malformed response.
  }
  return null
}

/**
 * Low-level request helper. Always resolves to the `data` field of a
 * successful jawbts-api envelope and throws `ApiError` / `NetworkError`
 * otherwise.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new NetworkError('The API did not respond in time. Check your connection and try again.')
    }
    throw new NetworkError('Could not reach the jawbts API. Check your connection and try again.')
  }

  const envelope = await readEnvelope(response)
  if (!envelope) {
    if (!response.ok) {
      throw new ApiError(
        null,
        response.status,
        null,
        null,
        `The API returned HTTP ${response.status} without a JSON body.`,
      )
    }
    throw new ApiError(
      null,
      response.status,
      null,
      null,
      'The API returned an unexpected response.',
    )
  }

  if (!response.ok || envelope.success !== true) {
    throw new ApiError(
      typeof envelope.code === 'number' ? envelope.code : null,
      response.status,
      envelope.data,
      typeof envelope.message === 'string' ? envelope.message : null,
    )
  }

  return envelope.data as T
}

/**
 * Typed wrapper around the jawbts-api endpoints used by this SPA.
 * All paths live at the root; there is no `/api` prefix.
 */
export const jawbtsApi = {
  login(username: string): Promise<LoginStart> {
    return apiRequest<LoginStart>('/auth/github/login', {
      method: 'POST',
      body: { username },
    })
  },

  completeGithubLogin(code: string, state: string): Promise<LoginComplete> {
    return apiRequest<LoginComplete>('/auth/github/callback', {
      method: 'POST',
      body: { code, state },
    })
  },

  refresh(refreshToken: string): Promise<RefreshResult> {
    return apiRequest<RefreshResult>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      // The API may send an activity alert before rotating, so allow more than
      // the old 25s. A timeout here is ambiguous: the server may already have
      // consumed the single-use refresh token.
      timeoutMs: 60_000,
    })
  },

  /** Revokes one of the caller's sessions by the id shown on the sessions screen. */
  revokeSession(token: string, sessionId: string): Promise<{ revoked: boolean }> {
    return apiRequest<{ revoked: boolean }>('/auth/revoke', {
      method: 'POST',
      token,
      body: { sessionId },
    })
  },

  getProfile(token: string): Promise<UserProfile> {
    return apiRequest<UserProfile>('/user', { token })
  },

  updateEmail(token: string, email: string): Promise<UserProfile> {
    return apiRequest<UserProfile>('/user', {
      method: 'PATCH',
      token,
      body: { email },
    })
  },

  listSessions(token: string): Promise<SessionList> {
    return apiRequest<SessionList>('/auth/sessions', { token })
  },

  issueToken(
    token: string,
    scope: string[],
    label?: string,
  ): Promise<IssuedToken> {
    const body: { scope: string[]; label?: string } = { scope }
    if (label) {
      body.label = label
    }
    return apiRequest<IssuedToken>('/auth/token', {
      method: 'POST',
      token,
      body,
    })
  },

  confirmEmail(emailToken: string): Promise<EmailConfirmResult> {
    return apiRequest<EmailConfirmResult>('/auth/email/confirm', {
      method: 'POST',
      body: { token: emailToken },
    })
  },
}

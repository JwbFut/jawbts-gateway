import { ApiError, NetworkError } from '@/lib/api'

/** Business codes from jawbts-api that identify a dead refresh-token session. */
const DEFINITIVE_AUTH_CODES = new Set([10002, 10005, 10006, 10008])

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError
}

export function isDefinitiveAuthFailure(error: unknown): boolean {
  return isApiError(error) && error.code !== null && DEFINITIVE_AUTH_CODES.has(error.code)
}

export function isTokenExpiredError(error: unknown): boolean {
  return isApiError(error) && error.code === 10005
}

export function isSessionLimitError(error: unknown): boolean {
  return isApiError(error) && error.code === 10004
}

export function isRateLimitError(error: unknown): boolean {
  return isApiError(error) && error.code === 10014
}

interface ErrorData {
  message?: unknown
  reason?: unknown
  where?: unknown
  issues?: unknown
  missing?: unknown
  permissions?: unknown
  required?: unknown
  retryAfterSeconds?: unknown
  active?: unknown
  limit?: unknown
}

function asRecord(value: unknown): ErrorData | null {
  return value && typeof value === 'object' ? (value as ErrorData) : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Control characters and Unicode bidi/zero-width controls can reorder or hide
 * text in a terminal. Nothing the API returns needs them, so normalise them
 * away before anything reaches the screen.
 */
const UNSAFE_DISPLAY_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

function cleanLine(value: string): string {
  return value.replace(UNSAFE_DISPLAY_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/** A single, human-readable sentence for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof NetworkError) {
    return error.message
  }
  if (error instanceof ApiError) {
    const data = asRecord(error.data)
    const specific = stringValue(data?.message) ?? stringValue(data?.reason)
    if (specific) {
      return cleanLine(specific)
    }
    const where = stringValue(data?.where)
    if (where) {
      return `${cleanLine(error.envelopeMessage ?? 'The request was rejected')} (${cleanLine(where)}).`
    }
    if (error.envelopeMessage) {
      return cleanLine(error.envelopeMessage)
    }
    return `The API request failed with HTTP ${error.status}.`
  }
  if (error instanceof Error) {
    return cleanLine(error.message)
  }
  return 'Something went wrong. Please try again.'
}

/** Field-level validation details, when the API returns Zod issues. */
export function errorDetails(error: unknown): string[] {
  if (!isApiError(error)) {
    return []
  }
  const data = asRecord(error.data)
  const details: string[] = []
  const issues = data?.issues
  if (issues && typeof issues === 'object' && !Array.isArray(issues)) {
    for (const [field, messages] of Object.entries(issues as Record<string, unknown>)) {
      const list = Array.isArray(messages) ? messages : [messages]
      for (const message of list) {
        const text = stringValue(message)
        if (text) {
          details.push(`${field}: ${text}`)
        }
      }
    }
  }
  if (Array.isArray(data?.missing)) {
    const missing = data.missing.filter((value): value is string => typeof value === 'string')
    if (missing.length) {
      details.push(`Missing permission: ${missing.join(', ')}`)
    }
  }
  if (Array.isArray(data?.permissions)) {
    const permissions = data.permissions.filter(
      (value): value is string => typeof value === 'string',
    )
    if (permissions.length) {
      details.push(`Not delegable: ${permissions.join(', ')}`)
    }
  }
  const required = stringValue(data?.required)
  if (required) {
    details.push(`Required: ${required}`)
  }
  return details.map(cleanLine).filter(Boolean)
}

/** A compact "10008 · User Not Found" style label for support screens. */
export function errorCodeLabel(error: unknown): string | null {
  if (!isApiError(error) || error.code === null) {
    return null
  }
  return `${error.code}${error.envelopeMessage ? ` · ${error.envelopeMessage}` : ''}`
}

/** The `retryAfterSeconds` hint from a 10014 rate-limit response, if any. */
export function retryAfterSeconds(error: unknown): number | null {
  if (!isApiError(error)) {
    return null
  }
  const data = asRecord(error.data)
  const value = data?.retryAfterSeconds
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null
}

/** Active/limit values from a 10004 session-limit response, if present. */
export function sessionLimitInfo(error: unknown): { active: number | null; limit: number | null } {
  if (!isApiError(error)) {
    return { active: null, limit: null }
  }
  const data = asRecord(error.data)
  return {
    active: typeof data?.active === 'number' ? data.active : null,
    limit: typeof data?.limit === 'number' ? data.limit : null,
  }
}

/**
 * Extra, muted terminal lines that explain an API error: field issues, missing
 * scopes, rate-limit retry hints, session caps, and the business code. The API
 * supplies all of this; without it, a Zod failure reads only "Bad Request".
 */
export function describeErrorLines(error: unknown): string[] {
  if (!isApiError(error)) {
    return []
  }
  const lines = errorDetails(error)
  if (isRateLimitError(error)) {
    const seconds = retryAfterSeconds(error)
    if (seconds !== null) {
      lines.push(`Retry in ${seconds} second${seconds === 1 ? '' : 's'}.`)
    }
  }
  if (isSessionLimitError(error)) {
    const { active, limit } = sessionLimitInfo(error)
    if (active !== null && limit !== null) {
      lines.push(`Active sessions: ${active} of ${limit}; revoke one to free a slot.`)
    } else if (limit !== null) {
      lines.push(`Session limit: ${limit}; revoke one to free a slot.`)
    }
  }
  const code = errorCodeLabel(error)
  if (code) {
    lines.push(`code ${code}`)
  }
  return lines.map(cleanLine).filter(Boolean)
}

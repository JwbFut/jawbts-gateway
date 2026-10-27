import { DEFAULT_AUTHENTICATED_PATH } from '@/config/app'

/**
 * Accepts only same-origin absolute paths. Rejects protocol-relative URLs
 * (`//evil`), backslash tricks, and control characters. Used for every
 * post-login redirect so `returnTo` cannot become an open redirect.
 */
export function safeInternalPath(
  value: unknown,
  fallback: string = DEFAULT_AUTHENTICATED_PATH,
): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback
  }
  // eslint-disable-next-line no-control-regex
  if (trimmed.includes('\\') || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return fallback
  }
  return trimmed
}

/** First string value of a vue-router query entry (which may be an array). */
export function firstQueryValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    const first = value.find((entry): entry is string => typeof entry === 'string')
    return first ?? null
  }
  return null
}

/** Minimal, UI-only JWT decoding. Never use these values for authorization. */

export interface AccessTokenClaims {
  iss?: string
  sub?: string
  sid?: string
  scope?: string[]
  jti?: string
  iat?: number
  exp?: number
  [claim: string]: unknown
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Decodes a JWT payload without verifying the signature. */
export function decodeJwt(token: string | null | undefined): AccessTokenClaims | null {
  if (!token) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(parts[1]))
    const payload = JSON.parse(json) as unknown
    return payload && typeof payload === 'object' ? (payload as AccessTokenClaims) : null
  } catch {
    return null
  }
}

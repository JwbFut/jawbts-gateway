import { describe, expect, it } from 'vitest'
import type { LocationQuery } from 'vue-router'

import {
  buildErrorRedirect,
  buildSuccessRedirect,
  parseAuthorizeQuery,
  type RedirectTarget,
} from '../src/lib/authorize'

const query = (value: Record<string, string | string[]>): LocationQuery =>
  value as LocationQuery

const target: RedirectTarget = {
  destination: new URL('https://app.jawbts.org/callback'),
  responseMode: 'fragment',
  state: 'state-1',
}

describe('parseAuthorizeQuery', () => {
  it('parses a valid request', () => {
    const result = parseAuthorizeQuery(
      query({
        redirect_uri: 'https://app.jawbts.org/callback',
        scope: 'play_sequence_override',
        state: 'abc',
        app_name: 'Jukebox',
        label: 'Kitchen',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.redirectUri).toBe('https://app.jawbts.org/callback')
    expect(result.request.responseMode).toBe('fragment')
    expect(result.request.scopes).toEqual(['play_sequence_override'])
    expect(result.request.appName).toBe('Jukebox')
    expect(result.request.label).toBe('Kitchen')
  })

  it('ignores the removed refresh-token option', () => {
    const result = parseAuthorizeQuery(
      query({
        redirect_uri: 'https://app.jawbts.org/callback',
        scope: 'play_sequence_override',
        include_refresh_token: 'false',
        refresh: 'false',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request).not.toHaveProperty('includeRefreshToken')
  })

  it('rejects non-allowlisted destinations and unknown scopes', () => {
    const result = parseAuthorizeQuery(
      query({
        redirect_uri: 'https://evil.example/callback',
        scope: 'play_sequence_override',
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((entry) => entry.includes('allowlist'))).toBe(true)

    const badScope = parseAuthorizeQuery(
      query({
        redirect_uri: 'https://app.jawbts.org/callback',
        scope: 'not_a_scope',
      }),
    )
    expect(badScope.ok).toBe(false)
  })

  it('rejects embedded credentials and http outside localhost', () => {
    const credentials = parseAuthorizeQuery(
      query({
        redirect_uri: 'https://user:pass@app.jawbts.org/callback',
        scope: 'play_sequence_override',
      }),
    )
    expect(credentials.ok).toBe(false)
    if (credentials.ok) return
    expect(credentials.errors.some((entry) => entry.includes('credentials'))).toBe(true)
    // Nothing may be redirected to a URL carrying userinfo.
    expect(credentials.target).toBeNull()

    const http = parseAuthorizeQuery(
      query({
        redirect_uri: 'http://app.jawbts.org/callback',
        scope: 'play_sequence_override',
      }),
    )
    expect(http.ok).toBe(false)
  })

  it('does not echo a truncated state', () => {
    const result = parseAuthorizeQuery(
      query({
        redirect_uri: 'https://app.jawbts.org/callback',
        scope: 'play_sequence_override',
        state: 'x'.repeat(1100),
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.state).toBeNull()
    expect(result.target?.state).toBeNull()
    expect(result.errors.some((entry) => entry.includes('state'))).toBe(true)
  })

  it('strips bidi and zero-width controls from display text', () => {
    const result = parseAuthorizeQuery(
      query({
        redirect_uri: 'https://app.jawbts.org/callback',
        scope: 'play_sequence_override',
        app_name: 'Juke\u202Ebox\u200B',
        label: 'Kit\u2066chen',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.appName).toBe('Juke box')
    expect(result.request.label).toBe('Kit chen')
  })
})

describe('token delivery', () => {
  it('uses the fragment by default and query only when requested', () => {
    const delivery = {
      token: 'access',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: ['play_sequence_override'],
      tokenId: 'token-id',
      refreshToken: 'refresh',
      refreshTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    }
    const fragment = new URL(buildSuccessRedirect(target, delivery))
    expect(fragment.search).toBe('')
    expect(fragment.hash).toContain('access_token=access')
    expect(fragment.hash).toContain('refresh_token=refresh')

    const queryMode = new URL(
      buildSuccessRedirect({ ...target, responseMode: 'query' }, delivery),
    )
    expect(queryMode.hash).toBe('')
    expect(queryMode.searchParams.get('access_token')).toBe('access')
    expect(queryMode.searchParams.get('state')).toBe('state-1')
  })
})

describe('buildErrorRedirect', () => {
  it('sanitises control and bidi characters in the description', () => {
    const url = buildErrorRedirect(target, 'invalid_request', 'bad\u0000 \u202Estate')
    const parsed = new URL(url)
    const description = new URLSearchParams(parsed.hash.slice(1)).get('error_description')
    expect(description).toBe('bad state')
  })
})

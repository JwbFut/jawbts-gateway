import type { LocationQuery, LocationQueryValue } from 'vue-router'

import { matchAllowedHost, type AllowlistMatch } from '@/config/allowlist'
import {
  DELEGABLE_SCOPES,
  getScopeDefinition,
  isDelegableScope,
  isKnownScope,
} from '@/config/scopes'

export type ResponseMode = 'fragment' | 'query'

/** The destination + how the response should be delivered to it. */
export interface RedirectTarget {
  destination: URL
  responseMode: ResponseMode
  state: string | null
}

export interface AuthorizeRequest extends RedirectTarget {
  /** Normalized absolute redirect URI. */
  redirectUri: string
  /** Validated allowlist match for the destination host. */
  allowlist: AllowlistMatch
  /** Requested, deduplicated, delegable scopes. */
  scopes: string[]
  /** Optional human-readable application name supplied by the requester. */
  appName: string | null
  /** Optional label stored on the delegated-token session. */
  label: string | null
}

export interface AuthorizeParseFailure {
  ok: false
  errors: string[]
  requestedScopes: string[]
  redirectUri: string | null
  destination: URL | null
  allowlist: AllowlistMatch | null
  state: string | null
  responseMode: ResponseMode
  appName: string | null
  label: string | null
  /** Set only when it is safe to send an error response to the destination. */
  target: RedirectTarget | null
}

export type AuthorizeParseResult =
  | { ok: true; request: AuthorizeRequest }
  | AuthorizeParseFailure

const MAX_STATE_LENGTH = 1024
const MAX_LABEL_LENGTH = 64
const MAX_APP_NAME_LENGTH = 64
const MAX_SCOPES = 20
const MAX_SCOPE_LENGTH = 64
const MAX_ERROR_DESCRIPTION_LENGTH = 300

/**
 * C0/C1 controls plus the Unicode bidi and zero-width controls that can
 * visually reorder a consent screen. None of them belong in a destination
 * name, label, state, or error description.
 */
const UNSAFE_DISPLAY_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

function cleanText(value: string | null): string | null {
  if (!value) {
    return null
  }
  const cleaned = value.replace(UNSAFE_DISPLAY_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || null
}

/** Sanitises a free-form error description before it is reflected back. */
export function sanitizeDescription(value: string): string {
  return value
    .replace(UNSAFE_DISPLAY_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_DESCRIPTION_LENGTH)
}

function valuesOf(query: LocationQuery, key: string): string[] {
  const raw: LocationQueryValue | LocationQueryValue[] | undefined = query[key]
  if (raw === undefined || raw === null) {
    return []
  }
  const list = Array.isArray(raw) ? raw : [raw]
  return list.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
}

function firstOf(query: LocationQuery, key: string): string | null {
  return valuesOf(query, key)[0] ?? null
}

function parseScopeList(values: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    for (const raw of value.split(/[\s,+]+/)) {
      const scope = raw.trim()
      if (scope && !seen.has(scope)) {
        seen.add(scope)
        result.push(scope)
      }
    }
  }
  return result
}

function parseResponseMode(value: string | null): ResponseMode | null {
  if (value === null) {
    return 'fragment'
  }
  const normalized = value.trim().toLowerCase()
  return normalized === 'fragment' || normalized === 'query' ? normalized : null
}

/**
 * Validates the query string of `/authorize`.
 *
 * Accepted parameters:
 * - `redirect_uri` (or `destination`): absolute URL on the built-in allowlist;
 * - `scope`: space- or comma-separated delegable scopes;
 * - `state` (echoed back), `app_name`, `label`;
 * - `response_mode`: `fragment` (default) or `query`.
 *
 * The delegated refresh token is always included. The old
 * `include_refresh_token` / `refresh` parameters are ignored.
 */
export function parseAuthorizeQuery(query: LocationQuery): AuthorizeParseResult {
  const errors: string[] = []

  const redirectValues = valuesOf(query, 'redirect_uri')
  const destinationValues = valuesOf(query, 'destination')
  if (redirectValues.length > 1) {
    errors.push('Provide exactly one redirect_uri parameter.')
  }
  if (destinationValues.length > 1) {
    errors.push('Provide exactly one destination parameter.')
  }
  if (
    redirectValues.length > 0 &&
    destinationValues.length > 0 &&
    redirectValues[0] !== destinationValues[0]
  ) {
    errors.push('redirect_uri and destination are aliases; provide only one of them.')
  }
  const redirectRaw = redirectValues[0] ?? destinationValues[0] ?? null

  const stateValues = valuesOf(query, 'state')
  if (stateValues.length > 1) {
    errors.push('Provide at most one state parameter.')
  }
  let state = cleanText(stateValues[0] ?? null)
  if (state && state.length > MAX_STATE_LENGTH) {
    errors.push(`state must be at most ${MAX_STATE_LENGTH} characters.`)
    // Echoing a truncated state would make every well-behaved client reject
    // the response. The request is invalid anyway; omit it rather than lie.
    state = null
  }

  const responseModeValues = valuesOf(query, 'response_mode')
  if (responseModeValues.length > 1) {
    errors.push('Provide at most one response_mode parameter.')
  }
  const responseMode = parseResponseMode(responseModeValues[0] ?? null)
  if (responseMode === null) {
    errors.push('response_mode must be "fragment" or "query".')
  }
  const effectiveResponseMode: ResponseMode = responseMode ?? 'fragment'

  const requestedScopes = parseScopeList(valuesOf(query, 'scope'))
  if (requestedScopes.length === 0) {
    errors.push(
      `At least one scope is required. Delegable scopes: ${DELEGABLE_SCOPES.map((scope) => scope.name).join(', ')}.`,
    )
  }
  if (requestedScopes.length > MAX_SCOPES) {
    errors.push(`At most ${MAX_SCOPES} scopes may be requested.`)
  }
  for (const scope of requestedScopes) {
    if (scope.length > MAX_SCOPE_LENGTH) {
      errors.push(`The scope "${scope.slice(0, 24)}…" is too long.`)
      continue
    }
    if (!isKnownScope(scope)) {
      errors.push(
        `Unknown scope "${scope}". Delegable scopes: ${DELEGABLE_SCOPES.map((entry) => entry.name).join(', ')}.`,
      )
      continue
    }
    if (!isDelegableScope(scope)) {
      const definition = getScopeDefinition(scope)
      errors.push(
        definition?.internal
          ? `The "${scope}" scope is internal and cannot be delegated.`
          : `The "${scope}" scope cannot be delegated.`,
      )
    }
  }

  const appNameRaw = cleanText(firstOf(query, 'app_name') ?? firstOf(query, 'client_name'))
  if (appNameRaw && appNameRaw.length > MAX_APP_NAME_LENGTH) {
    errors.push(`app_name must be at most ${MAX_APP_NAME_LENGTH} characters.`)
  }
  const appName = appNameRaw ? appNameRaw.slice(0, MAX_APP_NAME_LENGTH) : null

  const labelRaw = cleanText(firstOf(query, 'label'))
  if (labelRaw && labelRaw.length > MAX_LABEL_LENGTH) {
    errors.push(`label must be at most ${MAX_LABEL_LENGTH} characters.`)
  }
  const label = labelRaw ? labelRaw.slice(0, MAX_LABEL_LENGTH) : null

  let destination: URL | null = null
  let allowlist: AllowlistMatch | null = null
  let redirectUri: string | null = null

  if (!redirectRaw) {
    errors.push('A redirect_uri (or destination) parameter is required.')
  } else if (redirectRaw.length > 2048) {
    errors.push('redirect_uri must be at most 2048 characters.')
  } else {
    try {
      destination = new URL(redirectRaw)
    } catch {
      errors.push('redirect_uri must be an absolute URL, for example https://app.jawbts.org/callback.')
    }
  }

  if (destination) {
    redirectUri = destination.toString()
    if (destination.username || destination.password) {
      errors.push('redirect_uri must not contain embedded credentials.')
    }
    allowlist = matchAllowedHost(destination.hostname)
    if (!allowlist) {
      errors.push(`The destination host "${destination.hostname}" is not on the built-in allowlist.`)
    }
    const protocol = destination.protocol.toLowerCase()
    if (protocol !== 'https:' && protocol !== 'http:') {
      errors.push('redirect_uri must use HTTPS (HTTP is only allowed for localhost during development).')
    } else if (protocol === 'http:' && !allowlist?.rule.allowHttp) {
      errors.push('redirect_uri must use HTTPS. Plain HTTP is only allowed for localhost.')
    }
    if (effectiveResponseMode === 'fragment' && destination.hash) {
      errors.push(
        'redirect_uri must not contain a fragment when response_mode is "fragment". Use response_mode=query for hash-routed destinations.',
      )
    }
  }

  const protocol = destination?.protocol.toLowerCase()
  const protocolAllowed =
    protocol === 'https:' || (protocol === 'http:' && allowlist?.rule.allowHttp === true)
  const hasCredentials = Boolean(destination?.username || destination?.password)
  const target: RedirectTarget | null =
    destination && allowlist && redirectUri && protocolAllowed && !hasCredentials
      ? {
          destination: new URL(destination.toString()),
          responseMode: effectiveResponseMode,
          state,
        }
      : null

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      requestedScopes,
      redirectUri,
      destination,
      allowlist,
      state,
      responseMode: effectiveResponseMode,
      appName,
      label,
      target,
    }
  }

  return {
    ok: true,
    request: {
      destination: destination as URL,
      responseMode: effectiveResponseMode,
      state,
      redirectUri: redirectUri as string,
      allowlist: allowlist as AllowlistMatch,
      scopes: requestedScopes,
      appName,
      label,
    },
  }
}

export interface TokenDelivery {
  token: string
  tokenType: string
  expiresIn: number
  scope: string[]
  tokenId: string
  refreshToken: string
  refreshTokenExpiresAt: string
}

export type AuthorizeErrorCode =
  | 'access_denied'
  | 'invalid_request'
  | 'invalid_scope'
  | 'server_error'

function encodeFragment(params: URLSearchParams): string {
  // `+` is only a space in query strings; spell it out in the fragment for
  // clients that parse the fragment with a plain URL decoder.
  return params.toString().replace(/\+/g, '%20')
}

function applyParams(target: RedirectTarget, params: URLSearchParams): string {
  const url = new URL(target.destination.toString())
  if (target.responseMode === 'query') {
    for (const [key, value] of params) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }
  url.hash = encodeFragment(params)
  return url.toString()
}

/**
 * Builds the URL that hands the minted credentials to the destination.
 *
 * The API always mints a refresh token and every authorization delivers it.
 * There is no access-only path; the old include_refresh_token flag is ignored.
 */
export function buildSuccessRedirect(target: RedirectTarget, delivery: TokenDelivery): string {
  const params = new URLSearchParams()
  params.set('access_token', delivery.token)
  params.set('token_type', delivery.tokenType || 'Bearer')
  params.set('expires_in', String(delivery.expiresIn))
  params.set('scope', delivery.scope.join(' '))
  params.set('token_id', delivery.tokenId)
  params.set('refresh_token', delivery.refreshToken)
  params.set('refresh_token_expires_at', delivery.refreshTokenExpiresAt)
  if (target.state) {
    params.set('state', target.state)
  }
  return applyParams(target, params)
}

/** Builds the URL that tells the destination the request was denied/failed. */
export function buildErrorRedirect(
  target: RedirectTarget,
  error: AuthorizeErrorCode,
  description: string,
): string {
  const params = new URLSearchParams()
  params.set('error', error)
  params.set('error_description', sanitizeDescription(description))
  if (target.state) {
    params.set('state', target.state)
  }
  return applyParams(target, params)
}

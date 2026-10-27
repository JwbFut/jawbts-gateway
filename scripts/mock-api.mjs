/**
 * A tiny in-memory stand-in for jawbts-api, used only for local UI development
 * and manual smoke testing. It implements the endpoints this SPA calls and
 * mimics the real envelope, CORS, refresh-token rotation and id-based revoke.
 *
 * Usage:
 *   node scripts/mock-api.mjs            # listens on 127.0.0.1:3000
 *   MOCK_API_PORT=3100 node scripts/mock-api.mjs
 *
 * It is NOT a security boundary and must never be deployed.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_API_PORT ?? 3000)
const HOST = process.env.MOCK_API_HOST ?? '127.0.0.1'
const DAY = 24 * 60 * 60 * 1000
const EMAIL_TOKEN = 'mock-email-token-1234567890abcdef'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
}

const STATUS = {
  200: 200,
  10000: 404,
  10001: 400,
  10002: 401,
  10004: 429,
  10005: 401,
  10006: 401,
  10007: 403,
  10008: 404,
  10012: 502,
  10014: 429,
}
const MESSAGES = {
  200: 'OK',
  10000: 'Not Found',
  10001: 'Bad Request',
  10002: 'Unauthorized',
  10004: 'Session Limit Reached',
  10005: 'Token Expired',
  10006: 'Token Invalid',
  10007: 'Insufficient Scope',
  10008: 'User Not Found',
  10012: 'Activity Alert Failed',
  10014: 'Too Many Requests',
}

let state

function resetState() {
  state = {
    user: {
      id: 42,
      name: 'winsrewu',
      githubId: '78122384',
      permissions: ['issue_tokens', 'play_sequence_override'],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      email: 'winsrewu@jawbts.org',
    },
    pendingEmail: null,
    loginRefreshToken: `mock-login-refresh-${randomUUID()}`,
    loginPreviousRefreshToken: null,
    loginSessionId: 's-login-1',
    refreshSessionId: 's-refresh-1',
    loginRevoked: false,
    revokedSessionIds: [],
    delegated: [],
    counter: 0,
  }
}
resetState()

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function makeAccessToken(scope, sid, expiresInSeconds = 600) {
  const now = Math.floor(Date.now() / 1000)
  return [
    base64url({ alg: 'RS256', typ: 'JWT', kid: 'mock-key-1' }),
    base64url({
      iss: 'https://api.jawbts.org',
      sub: state.user.name,
      sid,
      scope,
      iat: now,
      exp: now + expiresInSeconds,
      jti: randomUUID(),
    }),
    'mock-signature',
  ].join('.')
}

function decodeAccessToken(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function presentUser() {
  const user = {
    ...state.user,
    updatedAt: new Date().toISOString(),
  }
  if (state.pendingEmail) {
    delete user.email
  } else {
    user.email = state.user.email
  }
  return user
}

function send(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok(res, data) {
  send(res, 200, { success: true, code: 200, message: 'OK', data })
}

function fail(res, code, data = {}, message = MESSAGES[code] ?? 'Error') {
  send(res, STATUS[code] ?? 500, {
    success: false,
    code,
    message,
    data,
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 128 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function bearer(req) {
  const header = req.headers.authorization ?? ''
  const [scheme, token] = header.split(' ')
  return scheme === 'Bearer' && token ? token : null
}

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function loginSessions() {
  const revoked = new Set(state.revokedSessionIds)
  if (state.loginRevoked) {
    revoked.add(state.loginSessionId)
    revoked.add(state.refreshSessionId)
  }
  return [
    {
      id: state.loginSessionId,
      type: 'GITHUB_LOGIN',
      permissions: [],
      label: null,
      parentId: null,
      expiresAt: nowIso(90 * DAY),
      createdAt: nowIso(-60 * 60 * 1000),
    },
    {
      id: state.refreshSessionId,
      type: 'REFRESH_TOKEN',
      permissions: [],
      label: null,
      parentId: state.loginSessionId,
      expiresAt: nowIso(90 * DAY),
      createdAt: nowIso(-59 * 60 * 1000),
    },
    {
      id: 's-login-2',
      type: 'GITHUB_LOGIN',
      permissions: [],
      label: null,
      parentId: null,
      expiresAt: nowIso(80 * DAY),
      createdAt: nowIso(-2 * DAY),
    },
    {
      id: 's-refresh-2',
      type: 'REFRESH_TOKEN',
      permissions: [],
      label: null,
      parentId: 's-login-2',
      expiresAt: nowIso(80 * DAY),
      createdAt: nowIso(-2 * DAY),
    },
  ].filter((session) => !revoked.has(session.id))
}

function sessionsResponse() {
  return {
    sessions: [
      ...loginSessions(),
      ...state.delegated.map(({ refreshToken: _refreshToken, ...session }) => session),
    ],
  }
}

function rotateLoginRefresh() {
  state.loginPreviousRefreshToken = state.loginRefreshToken
  state.loginRefreshToken = `mock-login-refresh-${randomUUID()}`
  return state.loginRefreshToken
}

function handleRefresh(body) {
  const presented = typeof body.refreshToken === 'string' ? body.refreshToken : ''
  if (!presented) {
    return { error: [10001, { issues: { refreshToken: ['Required'] } }] }
  }
  if (state.loginRevoked) {
    return { error: [10006, { message: 'Login session revoked' }] }
  }
  if (presented === state.loginRefreshToken) {
    const token = makeAccessToken(['api', 'issue_tokens'], state.refreshSessionId, 600)
    const refreshToken = rotateLoginRefresh()
    return {
      data: {
        token,
        tokenType: 'Bearer',
        alg: 'RS256',
        kid: 'mock-key-1',
        scope: ['api', 'issue_tokens'],
        expiresIn: 600,
        refreshToken,
        refreshTokenExpiresAt: nowIso(90 * DAY),
      },
    }
  }
  if (presented === state.loginPreviousRefreshToken) {
    state.loginRevoked = true
    return { error: [10006, { message: 'Refresh token reuse detected; session revoked' }] }
  }
  const delegated = state.delegated.find((session) => session.refreshToken === presented)
  if (delegated) {
    const token = makeAccessToken(delegated.permissions, delegated.id, 86400)
    const next = `mock-delegated-refresh-${++state.counter}`
    delegated.previousRefreshToken = delegated.refreshToken
    delegated.refreshToken = next
    return {
      data: {
        token,
        tokenType: 'Bearer',
        alg: 'RS256',
        kid: 'mock-key-1',
        scope: delegated.permissions,
        expiresIn: 86400,
        refreshToken: next,
        refreshTokenExpiresAt: nowIso(90 * DAY),
      },
    }
  }
  return { error: [10002, { message: 'Unknown refresh token' }] }
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  if (path === '/__mock/reset' && req.method === 'POST') {
    resetState()
    ok(res, { reset: true })
    return
  }

  if (path === '/__mock/state' && req.method === 'GET') {
    ok(res, {
      pendingEmail: state.pendingEmail,
      emailToken: EMAIL_TOKEN,
      loginRefreshToken: state.loginRefreshToken,
      refreshSessionId: state.refreshSessionId,
      delegatedCount: state.delegated.length,
    })
    return
  }

  if (path === '/' && req.method === 'GET') {
    ok(res, { name: 'jawbts-api (mock)' })
    return
  }

  if (path === '/text' && req.method === 'GET') {
    ok(res, { a: 'Hello', b: 'World!' })
    return
  }

  if (path === '/auth/github/login' && req.method === 'POST') {
    await readBody(req)
    ok(res, {
      authUrl: 'https://github.com/login/oauth/authorize?client_id=mock-client&state=mock-state',
      stateExpiresIn: 600,
    })
    return
  }

  if (path === '/auth/github/callback' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body.code || !body.state) {
      fail(res, 10011, { message: 'Invalid or expired OAuth state' })
      return
    }
    state.loginRevoked = false
    state.loginRefreshToken = `mock-login-refresh-${randomUUID()}`
    state.loginPreviousRefreshToken = null
    ok(res, {
      refreshToken: state.loginRefreshToken,
      sessionId: state.loginSessionId,
      tokenType: 'Bearer',
      expiresAt: nowIso(90 * DAY),
      expiresIn: Math.floor((90 * DAY) / 1000),
    })
    return
  }

  if (path === '/auth/refresh' && req.method === 'POST') {
    const body = await readBody(req)
    const result = handleRefresh(body)
    if (result.error) {
      fail(res, result.error[0], result.error[1])
      return
    }
    ok(res, result.data)
    return
  }

  if (path === '/auth/email/confirm' && req.method === 'POST') {
    const body = await readBody(req)
    const value = typeof body.token === 'string' ? body.token : ''
    if (value !== EMAIL_TOKEN) {
      fail(res, 10006, { message: 'Invalid or already used confirmation token' })
      return
    }
    if (!state.pendingEmail) {
      fail(res, 10006, { message: 'Invalid or already used confirmation token' })
      return
    }
    const email = state.pendingEmail
    state.user.email = email
    state.pendingEmail = null
    ok(res, { confirmed: true, email })
    return
  }

  // Everything below requires a bearer token.
  const token = bearer(req)
  if (!token) {
    fail(res, 10002, { message: 'Authorization: Bearer <token> is required' })
    return
  }
  const claims = decodeAccessToken(token)
  if (!claims) {
    fail(res, 10006, { valid: false, where: 'token format', reason: 'bad token' })
    return
  }

  if (path === '/user' && req.method === 'GET') {
    ok(res, presentUser())
    return
  }

  if (path === '/user' && req.method === 'PATCH') {
    const body = await readBody(req)
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail(res, 10001, { issues: { email: ['Invalid email address'] } })
      return
    }
    if (email.toLowerCase() === state.user.email.toLowerCase() && !state.pendingEmail) {
      ok(res, presentUser())
      return
    }
    state.pendingEmail = email
    ok(res, presentUser())
    return
  }

  if (path === '/auth/sessions' && req.method === 'GET') {
    ok(res, sessionsResponse())
    return
  }

  if (path === '/auth/revoke' && req.method === 'POST') {
    const body = await readBody(req)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sessionId) {
      fail(res, 10001, { issues: { sessionId: ['Required'] } })
      return
    }
    const loginPairs = {
      [state.loginSessionId]: [state.loginSessionId, state.refreshSessionId],
      [state.refreshSessionId]: [state.loginSessionId, state.refreshSessionId],
      's-login-2': ['s-login-2', 's-refresh-2'],
      's-refresh-2': ['s-login-2', 's-refresh-2'],
    }
    const pair = loginPairs[sessionId]
    if (pair) {
      for (const id of pair) {
        if (!state.revokedSessionIds.includes(id)) {
          state.revokedSessionIds.push(id)
        }
      }
      if (pair.includes(state.loginSessionId)) {
        state.loginRevoked = true
      }
      ok(res, { revoked: true })
      return
    }
    const index = state.delegated.findIndex((session) => session.id === sessionId)
    if (index >= 0) {
      state.delegated.splice(index, 1)
      ok(res, { revoked: true })
      return
    }
    fail(res, 10000, { message: 'Session not found' })
    return
  }

  if (path === '/auth/token' && req.method === 'POST') {
    const scope = Array.isArray(claims.scope) ? claims.scope : []
    if (!scope.includes('issue_tokens')) {
      fail(res, 10007, { message: 'token scope must include "issue_tokens"', required: 'issue_tokens' })
      return
    }
    if (state.delegated.length >= 20) {
      fail(res, 10004, {
        message: 'Already 20 active delegated tokens (max 20); revoke one first',
        active: state.delegated.length,
        limit: 20,
      })
      return
    }
    const body = await readBody(req)
    const requested = [...new Set(Array.isArray(body.scope) ? body.scope : [])]
    if (requested.length === 0) {
      fail(res, 10001, { issues: { scope: ['At least one scope is required'] } })
      return
    }
    const delegable = new Set(['play_sequence_override'])
    const unknown = requested.filter((value) => !delegable.has(value))
    if (unknown.length > 0) {
      fail(res, 10001, { message: 'Unknown permission(s)', issues: { scope: unknown } })
      return
    }
    const granted = new Set(state.user.permissions)
    const missing = requested.filter((value) => !granted.has(value))
    if (missing.length > 0) {
      fail(res, 10007, { message: 'Requested permission is not granted to this user', missing })
      return
    }
    const id = `s-delegated-${++state.counter}`
    const refreshToken = `mock-delegated-refresh-${state.counter}`
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null
    state.delegated.push({
      id,
      type: 'DELEGATED_TOKEN',
      permissions: requested,
      label,
      parentId: null,
      expiresAt: nowIso(90 * DAY),
      createdAt: nowIso(),
      refreshToken,
    })
    ok(res, {
      token: makeAccessToken(requested, id, 86400),
      tokenType: 'Bearer',
      alg: 'RS256',
      kid: 'mock-key-1',
      scope: requested,
      label,
      expiresIn: 86400,
      tokenId: id,
      refreshToken,
      refreshTokenExpiresAt: nowIso(90 * DAY),
    })
    return
  }

  fail(res, 10000, { message: `No mock route for ${req.method} ${path}` })
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[mock-api]', error)
    if (!res.headersSent) {
      fail(res, 10500, { message: 'Mock server error' })
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[mock-api] jawbts-api stand-in listening on http://${HOST}:${PORT}`)
  console.log(`[mock-api] email confirmation token: ${EMAIL_TOKEN}`)
})

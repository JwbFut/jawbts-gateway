import { describe, expect, it } from 'vitest'

import { ApiError } from '../src/lib/api'
import { describeError, describeErrorLines } from '../src/lib/errors'

const apiError = (code: number, data: unknown, envelope = 'Error') =>
  new ApiError(code, 400, data, envelope)

describe('describeErrorLines', () => {
  it('surfaces Zod field issues', () => {
    const lines = describeErrorLines(
      apiError(10001, { issues: { email: ['Reserved email domain'] } }, 'Bad Request'),
    )
    expect(lines).toEqual(['email: Reserved email domain', 'code 10001 · Bad Request'])
  })

  it('surfaces the rate-limit retry hint', () => {
    const lines = describeErrorLines(
      apiError(10014, { retryAfterSeconds: 42 }, 'Too Many Requests'),
    )
    expect(lines).toEqual(['Retry in 42 seconds.', 'code 10014 · Too Many Requests'])
  })

  it('surfaces session-limit counts and missing scopes', () => {
    expect(
      describeErrorLines(apiError(10004, { active: 3, limit: 3 }, 'Session Limit Reached')),
    ).toContain('Active sessions: 3 of 3; revoke one to free a slot.')

    const scopeLines = describeErrorLines(
      apiError(
        10007,
        { message: 'Requested permission is not granted', missing: ['play_sequence_override'] },
        'Insufficient Scope',
      ),
    )
    expect(scopeLines).toContain('Missing permission: play_sequence_override')

    const requiredLines = describeErrorLines(
      apiError(10007, { message: 'Token scope must include issue_tokens', required: 'issue_tokens' }),
    )
    expect(requiredLines).toContain('Required: issue_tokens')
  })

  it('returns nothing for non-API errors', () => {
    expect(describeErrorLines(new Error('offline'))).toEqual([])
  })
})

describe('describeError', () => {
  it('strips bidi/control characters from API messages', () => {
    expect(
      describeError(apiError(10001, { message: 'bad\u0000 \u202Emessage' }, 'Bad Request')),
    ).toBe('bad message')
  })
})

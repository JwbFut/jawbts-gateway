import { describe, expect, it } from 'vitest'

import { describeAllowedHosts, matchAllowedHost } from '../src/config/allowlist'

describe('matchAllowedHost', () => {
  it('matches jawbts.org and its subdomains', () => {
    expect(matchAllowedHost('jawbts.org')?.viaSubdomain).toBe(false)
    expect(matchAllowedHost('app.jawbts.org')?.viaSubdomain).toBe(true)
    expect(matchAllowedHost('APP.JAWBTS.ORG.')?.hostname).toBe('app.jawbts.org')
  })

  it('does not match lookalike domains', () => {
    expect(matchAllowedHost('eviljawbts.org')).toBeNull()
    expect(matchAllowedHost('jawbts.org.evil.example')).toBeNull()
    expect(matchAllowedHost('notjawbts.org')).toBeNull()
  })

  it('includes localhost in the test/development build', () => {
    expect(matchAllowedHost('localhost')?.rule.allowHttp).toBe(true)
    expect(describeAllowedHosts().some((entry) => entry.startsWith('localhost'))).toBe(true)
  })
})

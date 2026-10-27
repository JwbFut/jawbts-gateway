import { describe, expect, it } from 'vitest'

import { BUILD_HASH, LICENSE_NOTICE, validateApiBase } from '../src/config/app'

describe('build banner', () => {
  it('always exposes a non-empty build hash', () => {
    expect(BUILD_HASH.length).toBeGreaterThan(0)
    expect(BUILD_HASH).not.toContain(' ')
  })

  it('exposes the GPL license notice', () => {
    expect(LICENSE_NOTICE).toContain('(c)')
    expect(LICENSE_NOTICE).toContain('GNU General Public License v3.0')
    expect(LICENSE_NOTICE).not.toContain('All rights reserved')
  })
})

describe('validateApiBase', () => {
  it('accepts an absolute HTTPS URL in production', () => {
    expect(() => validateApiBase('https://api.jawbts.org', false)).not.toThrow()
  })

  it('rejects plain HTTP in production but allows it in development', () => {
    expect(() => validateApiBase('http://api.jawbts.org', false)).toThrow(/HTTPS/)
    expect(() => validateApiBase('http://localhost:3000', true)).not.toThrow()
  })

  it('rejects a local development host in a production build', () => {
    expect(() => validateApiBase('https://localhost:3000', false)).toThrow(/local development/)
    expect(() => validateApiBase('https://127.0.0.1', false)).toThrow(/local development/)
  })

  it('rejects relative and malformed values', () => {
    expect(() => validateApiBase('/api', false)).toThrow(/absolute URL/)
    expect(() => validateApiBase('not a url', false)).toThrow(/absolute URL/)
  })
})

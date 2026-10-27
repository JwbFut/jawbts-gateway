import { describe, expect, it } from 'vitest'

import { firstQueryValue, safeInternalPath } from '../src/lib/navigation'

describe('safeInternalPath', () => {
  it('accepts same-origin paths with query/hash', () => {
    expect(safeInternalPath('/account')).toBe('/account')
    expect(safeInternalPath('/authorize?scope=x&state=y')).toBe('/authorize?scope=x&state=y')
    expect(safeInternalPath('/account#sessions')).toBe('/account#sessions')
  })

  it('rejects protocol-relative, backslash and non-path values', () => {
    expect(safeInternalPath('//evil.example')).toBe('/account')
    expect(safeInternalPath('/\\evil.example')).toBe('/account')
    expect(safeInternalPath('https://evil.example')).toBe('/account')
    expect(safeInternalPath('javascript:alert(1)')).toBe('/account')
    expect(safeInternalPath('/ok\\bad')).toBe('/account')
    expect(safeInternalPath(null)).toBe('/account')
  })

  it('uses the requested fallback', () => {
    expect(safeInternalPath(undefined, '/login')).toBe('/login')
  })
})

describe('firstQueryValue', () => {
  it('takes the first string from arrays', () => {
    expect(firstQueryValue(['a', 'b'])).toBe('a')
    expect(firstQueryValue('a')).toBe('a')
    expect(firstQueryValue([null, 'b'])).toBe('b')
    expect(firstQueryValue(null)).toBeNull()
  })
})

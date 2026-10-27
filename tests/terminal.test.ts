import { describe, expect, it } from 'vitest'

import { redactCommand } from '../src/lib/terminal'

describe('redactCommand', () => {
  it('hides the arguments of revoke', () => {
    expect(redactCommand('revoke abc123')).toBe('revoke <redacted>')
    expect(redactCommand('  REVOKE   abc123  ')).toBe('revoke <redacted>')
    expect(redactCommand('revoke a b')).toBe('revoke <redacted>')
  })

  it('leaves other commands and a bare revoke alone', () => {
    expect(redactCommand('status')).toBe('status')
    expect(redactCommand('  email set a@b.c  ')).toBe('email set a@b.c')
    expect(redactCommand('revoke')).toBe('revoke')
  })
})

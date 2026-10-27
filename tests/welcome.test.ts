import { describe, expect, it } from 'vitest'

import { greetingFor } from '../src/lib/welcome'

const at = (hour: number) => new Date(2026, 0, 1, hour, 0, 0)

describe('greetingFor', () => {
  it('maps the local hour to the requested greeting', () => {
    expect(greetingFor(at(0))).toBe('midnight')
    expect(greetingFor(at(4))).toBe('midnight')
    expect(greetingFor(at(5))).toBe('morning')
    expect(greetingFor(at(11))).toBe('morning')
    expect(greetingFor(at(12))).toBe('afternoon')
    expect(greetingFor(at(17))).toBe('afternoon')
    expect(greetingFor(at(18))).toBe('evening')
    expect(greetingFor(at(21))).toBe('evening')
    expect(greetingFor(at(22))).toBe('midnight')
    expect(greetingFor(at(23))).toBe('midnight')
  })
})

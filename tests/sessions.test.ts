import { describe, expect, it } from 'vitest'

import { groupSessions } from '../src/lib/sessions'
import type { SessionInfo, SessionType } from '../src/types/api'

const CREATED = '2026-11-01T00:00:00.000Z'
const EXPIRES = '2027-01-30T00:00:00.000Z'

function session(
  overrides: Partial<SessionInfo> & { id: string; type: SessionType },
): SessionInfo {
  return {
    permissions: [],
    label: null,
    parentId: null,
    expiresAt: EXPIRES,
    createdAt: CREATED,
    ...overrides,
  }
}

describe('groupSessions', () => {
  it('treats a REFRESH_TOKEN root as the login (new API model)', () => {
    const root = session({ id: 'root-1', type: 'REFRESH_TOKEN' })
    const delegated = session({
      id: 'delegated-1',
      type: 'DELEGATED_TOKEN',
      permissions: ['play_sequence_override'],
      label: 'Jukebox',
    })

    const groups = groupSessions([root, delegated], 'root-1')

    expect(groups.logins).toEqual([
      {
        id: 'root-1',
        refreshId: 'root-1',
        state: 'active',
        current: true,
        createdAt: CREATED,
        expiresAt: EXPIRES,
      },
    ])
    expect(groups.delegated).toEqual([delegated])
    expect(groups.other).toEqual([])
  })

  it('folds a legacy REFRESH_TOKEN child into its GITHUB_LOGIN parent', () => {
    const parent = session({ id: 'login-1', type: 'GITHUB_LOGIN' })
    const child = session({
      id: 'refresh-1',
      type: 'REFRESH_TOKEN',
      parentId: 'login-1',
      expiresAt: '2027-02-01T00:00:00.000Z',
    })

    const groups = groupSessions([parent, child], 'refresh-1')

    expect(groups.logins).toHaveLength(1)
    expect(groups.logins[0]).toEqual({
      id: 'login-1',
      refreshId: 'refresh-1',
      state: 'legacy',
      current: true,
      createdAt: CREATED,
      expiresAt: '2027-02-01T00:00:00.000Z',
    })
  })

  it('marks an unredeemed GITHUB_LOGIN row as pending', () => {
    const pending = session({ id: 'pending-1', type: 'GITHUB_LOGIN' })

    const groups = groupSessions([pending], null)

    expect(groups.logins).toEqual([
      {
        id: 'pending-1',
        refreshId: null,
        state: 'pending',
        current: false,
        createdAt: CREATED,
        expiresAt: EXPIRES,
      },
    ])
  })

  it('keeps logins in API order without double-counting a legacy child', () => {
    const root = session({ id: 'root-new', type: 'REFRESH_TOKEN' })
    const parent = session({ id: 'login-old', type: 'GITHUB_LOGIN', createdAt: '2026-10-01T00:00:00.000Z' })
    const child = session({
      id: 'refresh-old',
      type: 'REFRESH_TOKEN',
      parentId: 'login-old',
      createdAt: '2026-10-01T00:00:00.000Z',
    })

    const groups = groupSessions([root, parent, child], 'root-new')

    expect(groups.logins.map((login) => login.id)).toEqual(['root-new', 'login-old'])
    expect(groups.logins.map((login) => login.current)).toEqual([true, false])
  })

  it('sorts delegated tokens newest first and isolates unknown types', () => {
    const older = session({
      id: 'delegated-old',
      type: 'DELEGATED_TOKEN',
      createdAt: '2026-10-01T00:00:00.000Z',
    })
    const newer = session({
      id: 'delegated-new',
      type: 'DELEGATED_TOKEN',
      createdAt: '2026-11-01T00:00:00.000Z',
    })
    const unknown = session({
      id: 'mystery-1',
      type: 'SOMETHING_ELSE' as SessionType,
    })

    const groups = groupSessions([older, newer, unknown], null)

    expect(groups.delegated.map((item) => item.id)).toEqual(['delegated-new', 'delegated-old'])
    expect(groups.other.map((item) => item.id)).toEqual(['mystery-1'])
  })
})

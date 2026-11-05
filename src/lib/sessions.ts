import type { SessionInfo } from '@/types/api'

/**
 * How a login session is represented:
 * - `active`: a `REFRESH_TOKEN` root row created by the current API. The row is
 *   both the login and its refresh token, and has no parent.
 * - `legacy`: an older `GITHUB_LOGIN` parent with a `REFRESH_TOKEN` child. The
 *   API still supports revoking either id and removes the whole pair.
 * - `pending`: a `GITHUB_LOGIN` row whose OAuth state has not been redeemed
 *   yet. It expires after about a minute and is not a usable login; jawbts-api
 *   caps how many of these can be in flight, not how many completed logins a
 *   user may keep.
 */
export type LoginSessionState = 'active' | 'pending' | 'legacy'

export interface LoginSessionView {
  /** Id to show and to pass to `revoke`; the API accepts it for this login. */
  id: string
  /**
   * `REFRESH_TOKEN` row behind this login. For a root login this equals `id`;
   * for a pending login it is null.
   */
  refreshId: string | null
  state: LoginSessionState
  /** True when this login minted the JWT currently in use (`sid` claim). */
  current: boolean
  createdAt: string
  expiresAt: string
}

export interface SessionGroups {
  logins: LoginSessionView[]
  delegated: SessionInfo[]
  /** Rows with a type this build does not recognise; kept so nothing vanishes. */
  other: SessionInfo[]
}

/**
 * Groups `/auth/sessions` rows into the logins and delegated tokens the
 * terminal displays.
 *
 * jawbts-api changed logins from a `GITHUB_LOGIN` parent with a
 * `REFRESH_TOKEN` child to a single `REFRESH_TOKEN` root (`parentId: null`).
 * Both shapes can coexist in one account, so a child is folded into its
 * parent and never listed twice.
 */
export function groupSessions(
  sessions: readonly SessionInfo[],
  currentSid: string | null,
): SessionGroups {
  // A legacy child is created after its parent, so map it before walking the
  // list: the API returns rows newest first and the parent still owns the row.
  const childByParent = new Map<string, SessionInfo>()
  for (const session of sessions) {
    if (session.type === 'REFRESH_TOKEN' && session.parentId) {
      childByParent.set(session.parentId, session)
    }
  }

  const logins: LoginSessionView[] = []
  const delegated: SessionInfo[] = []
  const other: SessionInfo[] = []

  for (const session of sessions) {
    switch (session.type) {
      case 'GITHUB_LOGIN': {
        const child = childByParent.get(session.id) ?? null
        logins.push({
          id: session.id,
          refreshId: child?.id ?? null,
          state: child ? 'legacy' : 'pending',
          current:
            currentSid !== null &&
            (child?.id === currentSid || session.id === currentSid),
          createdAt: session.createdAt,
          expiresAt: child?.expiresAt ?? session.expiresAt,
        })
        break
      }
      case 'REFRESH_TOKEN': {
        // Legacy child: represented by its GITHUB_LOGIN parent above.
        if (session.parentId !== null) {
          break
        }
        logins.push({
          id: session.id,
          refreshId: session.id,
          state: 'active',
          current: currentSid !== null && session.id === currentSid,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })
        break
      }
      case 'DELEGATED_TOKEN':
        delegated.push(session)
        break
      default:
        other.push(session)
    }
  }

  delegated.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  return { logins, delegated, other }
}

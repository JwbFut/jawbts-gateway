/**
 * Client-side catalogue of the permissions jawbts-api knows about.
 *
 * The API is still authoritative: it re-checks every scope against the user's
 * current grants. This catalogue exists so the consent screen can identify the
 * requested scopes and refuse to show an opaque scope.
 */
export interface ScopeDefinition {
  /** The value that appears in a JWT `scope` claim. */
  readonly name: string
  /** Short English label. */
  readonly title: string
  /** Whether `/auth/token` may mint a token carrying this scope. */
  readonly delegable: boolean
  /** `account` scopes are internal to GitHub-login tokens. */
  readonly internal: boolean
}

export const SCOPE_CATALOG: readonly ScopeDefinition[] = [
  {
    name: 'api',
    title: 'Account API',
    delegable: false,
    internal: true,
  },
  {
    name: 'issue_tokens',
    title: 'Issue tokens',
    delegable: false,
    internal: true,
  },
  {
    name: 'play_sequence_override',
    title: 'Music sequence override',
    delegable: true,
    internal: false,
  },
]

export const DELEGABLE_SCOPES = SCOPE_CATALOG.filter((scope) => scope.delegable)

const SCOPE_BY_NAME = new Map(SCOPE_CATALOG.map((scope) => [scope.name, scope]))

export function getScopeDefinition(name: string): ScopeDefinition | undefined {
  return SCOPE_BY_NAME.get(name)
}

export function isKnownScope(name: string): boolean {
  return SCOPE_BY_NAME.has(name)
}

export function isDelegableScope(name: string): boolean {
  return SCOPE_BY_NAME.get(name)?.delegable === true
}

/** Best-effort label for a permission code that may not be in the catalogue. */
export function permissionLabel(name: string): string {
  return SCOPE_BY_NAME.get(name)?.title ?? name
}

/**
 * Built-in redirect allowlist for the token-issuance page (`/authorize`).
 *
 * This is intentionally code, not a query parameter and not user-editable at
 * runtime: an open redirect on an authorization page would leak access and
 * refresh tokens. Add a production destination here and rebuild the SPA.
 *
 * Matching rules:
 * - hostnames are compared after lowercasing and stripping trailing dots;
 * - `includeSubdomains` also accepts any subdomain of the listed host;
 * - plain HTTP is only accepted for rules that opt in (`allowHttp`), which is
 *   limited to local development hosts.
 */
export interface AllowedHostRule {
  /** Hostname without a scheme or path. IPv6 literals keep their brackets. */
  readonly host: string
  /** Accept every subdomain (`app.example.com` when host is `example.com`). */
  readonly includeSubdomains: boolean
  /** Permits `http:` in addition to `https:`. Keep this false in production. */
  readonly allowHttp: boolean
}

const LOCAL_HOSTS: readonly AllowedHostRule[] = import.meta.env.DEV
  ? [
      { host: 'localhost', includeSubdomains: false, allowHttp: true },
      { host: '127.0.0.1', includeSubdomains: false, allowHttp: true },
      { host: '[::1]', includeSubdomains: false, allowHttp: true },
    ]
  : []

export const BUILT_IN_ALLOWED_HOSTS: readonly AllowedHostRule[] = [
  // Every jawbts.org subdomain is trusted as a token destination. Keep this
  // only while all subdomains are owned by the same team: the API does not
  // receive the post-consent redirect URI, so this list is the destination guard.
  { host: 'jawbts.org', includeSubdomains: true, allowHttp: false },
  ...LOCAL_HOSTS,
]

export interface AllowlistMatch {
  rule: AllowedHostRule
  /** The normalized hostname from the destination URL. */
  hostname: string
  /** The entry in the allowlist that produced the match. */
  matchedDomain: string
  /** True when the destination is a subdomain of the matched entry. */
  viaSubdomain: boolean
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '')
}

export function matchAllowedHost(hostname: string): AllowlistMatch | null {
  const host = normalizeHostname(hostname)
  if (!host) {
    return null
  }
  for (const rule of BUILT_IN_ALLOWED_HOSTS) {
    const domain = normalizeHostname(rule.host)
    if (host === domain) {
      return {
        rule,
        hostname: host,
        matchedDomain: domain,
        viaSubdomain: false,
      }
    }
    if (rule.includeSubdomains && host.endsWith(`.${domain}`)) {
      return {
        rule,
        hostname: host,
        matchedDomain: domain,
        viaSubdomain: true,
      }
    }
  }
  return null
}

/** Human-readable allowlist summary used on the consent and error screens. */
export function describeAllowedHosts(): string[] {
  return BUILT_IN_ALLOWED_HOSTS.map((rule) => {
    if (rule.host === 'localhost' || rule.host === '127.0.0.1' || rule.host === '[::1]') {
      return `${rule.host} (development only, HTTP allowed)`
    }
    return rule.includeSubdomains ? `${rule.host} and its subdomains` : rule.host
  })
}

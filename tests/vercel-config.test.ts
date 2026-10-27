import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface HeaderRule {
  source: string
  headers: Array<{ key: string; value: string }>
}

interface VercelConfig {
  headers: HeaderRule[]
}

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as VercelConfig

// Vercel applies every matching headers rule in file order and the last match
// wins for a given key. Keep the hashed-asset rule after the catch-all.
function matches(source: string, path: string): boolean {
  if (source === '/(.*)') {
    return path.startsWith('/')
  }
  if (source.endsWith('/(.*)')) {
    const prefix = source.slice(0, -'(.*)'.length)
    return path.startsWith(prefix)
  }
  return path === source
}

function headerFor(path: string, key: string): string | undefined {
  let value: string | undefined
  for (const rule of config.headers) {
    if (!matches(rule.source, path)) continue
    const header = rule.headers.find((entry) => entry.key.toLowerCase() === key)
    if (header) value = header.value
  }
  return value
}

describe('vercel caching', () => {
  it('caches hashed assets immutably', () => {
    expect(headerFor('/assets/index-abc123.js', 'cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(headerFor('/assets/index-abc123.css', 'cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
  })

  it('revalidates HTML and SPA routes', () => {
    for (const path of ['/', '/account', '/authorize', '/index.html', '/robots.txt']) {
      expect(headerFor(path, 'cache-control')).toBe(
        'private, no-cache, must-revalidate',
      )
    }
  })

  it('keeps baseline security headers on assets and routes', () => {
    expect(headerFor('/assets/index-abc123.js', 'x-content-type-options')).toBe('nosniff')
    expect(headerFor('/account', 'x-frame-options')).toBe('DENY')
    expect(headerFor('/account', 'referrer-policy')).toBe('no-referrer')
  })
})

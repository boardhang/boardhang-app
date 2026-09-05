import { describe, expect, it } from 'vitest'
import { CANONICAL_ORIGIN, resolveOrigin } from './origin.js'

const env = {
  VERCEL_URL: 'boardly-abc123-team.vercel.app',
  VERCEL_BRANCH_URL: 'boardly-git-feat-team.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'boardly.vercel.app',
}

describe('resolveOrigin', () => {
  it('uses the production host as-is', () => {
    expect(resolveOrigin(new Headers({ host: 'www.boardhang.app' }), env)).toBe('https://www.boardhang.app')
  })

  it("uses the deployment's own hosts as-is, case-insensitively", () => {
    expect(resolveOrigin(new Headers({ host: 'Boardly-abc123-team.vercel.app' }), env)).toBe(
      'https://boardly-abc123-team.vercel.app',
    )
    expect(resolveOrigin(new Headers({ host: env.VERCEL_BRANCH_URL }), env)).toBe(`https://${env.VERCEL_BRANCH_URL}`)
    expect(resolveOrigin(new Headers({ host: env.VERCEL_PROJECT_PRODUCTION_URL }), env)).toBe(
      `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
    )
  })

  it('falls back to the canonical origin for a spoofed or missing host', () => {
    expect(resolveOrigin(new Headers({ host: 'evil.example' }), env)).toBe(CANONICAL_ORIGIN)
    expect(resolveOrigin(new Headers(), env)).toBe(CANONICAL_ORIGIN)
    expect(resolveOrigin(new Headers({ host: 'www.boardhang.app.evil.example' }), env)).toBe(CANONICAL_ORIGIN)
  })

  it('prefers x-forwarded-host when present and allowlisted', () => {
    const headers = new Headers({ host: 'internal', 'x-forwarded-host': 'www.boardhang.app' })
    expect(resolveOrigin(headers, env)).toBe('https://www.boardhang.app')
  })
})

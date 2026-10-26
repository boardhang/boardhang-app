import { describe, expect, it } from 'vitest'
import { isAdminUser } from './admin'

// Plan R1 / AE11: only the server-controlled app_metadata.role === 'admin' counts.

describe('isAdminUser', () => {
  it('is true for app_metadata.role === "admin"', () => {
    expect(isAdminUser({ app_metadata: { role: 'admin' } })).toBe(true)
  })

  it.each([
    ['a different case', { app_metadata: { role: 'Admin' } }],
    ['another role', { app_metadata: { role: 'editor' } }],
    ['an empty app_metadata', { app_metadata: {} }],
    ['no app_metadata', {}],
    ['a non-object app_metadata', { app_metadata: 'admin' }],
    ['user_metadata only (user-writable, must not grant admin)', { user_metadata: { role: 'admin' } }],
  ])('is false for %s', (_label, user) => {
    expect(isAdminUser(user as { app_metadata?: unknown })).toBe(false)
  })

  it('is false for null and undefined', () => {
    expect(isAdminUser(null)).toBe(false)
    expect(isAdminUser(undefined)).toBe(false)
  })
})

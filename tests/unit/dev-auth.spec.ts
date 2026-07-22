import { describe, expect, it } from 'vitest'
import { devExternalId, isDevAuthConfigured, verifyDevAuth } from '../../server/utils/dev-auth'

const enabled = {
  CONTENT_FACTORY_ENV: 'development',
  DEV_AUTH_ENABLED: 'true',
  DEV_AUTH_EMAIL: 'dev@example.test',
  DEV_AUTH_PASSWORD: 'a-strong-development-password',
}

describe('isolated ContentFactory development auth', () => {
  it('requires the development environment and explicit enable flag', () => {
    expect(isDevAuthConfigured(enabled)).toBe(true)
    expect(isDevAuthConfigured({ ...enabled, CONTENT_FACTORY_ENV: 'production' })).toBe(false)
    expect(isDevAuthConfigured({ ...enabled, DEV_AUTH_ENABLED: 'false' })).toBe(false)
  })

  it('accepts only the configured email and password', () => {
    expect(verifyDevAuth('DEV@example.test', 'a-strong-development-password', enabled)).toBe(true)
    expect(verifyDevAuth('other@example.test', 'a-strong-development-password', enabled)).toBe(false)
    expect(verifyDevAuth('dev@example.test', 'wrong-password', enabled)).toBe(false)
  })

  it('does not authenticate when credentials are incomplete', () => {
    expect(verifyDevAuth('dev@example.test', 'a-strong-development-password', { ...enabled, DEV_AUTH_PASSWORD: '' })).toBe(false)
  })

  it('creates a stable negative external id outside the normal provider range', () => {
    const id = devExternalId('dev@example.test')
    expect(id).toBeLessThan(0)
    expect(devExternalId('DEV@example.test')).toBe(id)
  })
})
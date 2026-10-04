import { describe, expect, it } from 'vitest'
import { assertProductionConfig } from './config.js'

describe('assertProductionConfig', () => {
  it('does not throw outside production', () => {
    expect(() => assertProductionConfig({})).not.toThrow()
  })

  it('requires GOOGLE_CLIENT_SECRET in production', () => {
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }),
    ).toThrow(/GOOGLE_CLIENT_SECRET/)
  })

  it('requires DATABASE_URL in production', () => {
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'production', GOOGLE_CLIENT_SECRET: 's' }),
    ).toThrow(/DATABASE_URL/)
  })

  it('passes in production when both are set', () => {
    expect(() =>
      assertProductionConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        GOOGLE_CLIENT_SECRET: 's',
      }),
    ).not.toThrow()
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertOidcClaims, emailFromClaims, OidcError } from '../src/services/auth/oidc-claims.ts'

const env = {
  issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
  clientId: 'app-client-id',
  tenantId: 'tenant-id',
}

describe('oidc claims', () => {
  it('reads email from the email claim', () => {
    assert.equal(emailFromClaims({ email: 'Ada@Contoso.com' }), 'ada@contoso.com')
  })

  it('falls back to preferred_username when it looks like an email', () => {
    assert.equal(
      emailFromClaims({ preferred_username: 'ada@contoso.com' }),
      'ada@contoso.com',
    )
  })

  it('ignores preferred_username without @', () => {
    assert.equal(emailFromClaims({ preferred_username: 'ada' }), null)
  })

  it('accepts matching iss, aud, and tid', () => {
    assert.doesNotThrow(() =>
      assertOidcClaims(
        {
          iss: env.issuer,
          aud: env.clientId,
          tid: env.tenantId,
          exp: Math.floor(Date.now() / 1000) + 60,
        },
        env,
      ),
    )
  })

  it('rejects a different tenant', () => {
    assert.throws(
      () =>
        assertOidcClaims(
          {
            iss: env.issuer,
            aud: env.clientId,
            tid: 'other-tenant',
            exp: Math.floor(Date.now() / 1000) + 60,
          },
          env,
        ),
      (error: unknown) => error instanceof OidcError && error.name === 'OidcInvalidToken',
    )
  })

  it('accepts aud as an array that includes the client id', () => {
    assert.doesNotThrow(() =>
      assertOidcClaims(
        {
          iss: env.issuer,
          aud: ['other-app', env.clientId],
          tid: env.tenantId,
          exp: Math.floor(Date.now() / 1000) + 60,
        },
        env,
      ),
    )
  })

  it('rejects a different issuer', () => {
    assert.throws(
      () =>
        assertOidcClaims(
          {
            iss: 'https://example.com',
            aud: env.clientId,
            tid: env.tenantId,
            exp: Math.floor(Date.now() / 1000) + 60,
          },
          env,
        ),
      (error: unknown) => error instanceof OidcError && error.name === 'OidcInvalidToken',
    )
  })

  it('rejects an expired token', () => {
    assert.throws(
      () =>
        assertOidcClaims(
          {
            iss: env.issuer,
            aud: env.clientId,
            tid: env.tenantId,
            exp: Math.floor(Date.now() / 1000) - 10,
          },
          env,
        ),
      (error: unknown) => error instanceof OidcError && error.name === 'OidcInvalidToken',
    )
  })
})

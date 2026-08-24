import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { Core } from '@strapi/strapi'
import { getAuthMode } from '../../utils/auth-mode'
import {
  assertOidcClaims,
  emailFromClaims,
  namesFromClaims,
  OidcError,
  type OidcEnv,
} from './oidc-claims'
import { isAccountBlocked } from '../../utils/account-status'
import { refreshLinkedEmployeeIdentity } from '../../utils/employee-scope'

export { assertOidcClaims, emailFromClaims, namesFromClaims, OidcError, type OidcEnv }

export function getOidcEnv(): OidcEnv | null {
  if (getAuthMode() !== 'oidc') return null
  const issuer = process.env.OIDC_ISSUER?.trim()
  const clientId = process.env.OIDC_CLIENT_ID?.trim()
  const tenantId = process.env.OIDC_TENANT_ID?.trim()
  if (!issuer || !clientId || !tenantId) return null
  return { issuer: issuer.replace(/\/$/, ''), clientId, tenantId }
}

function jwksUrl(env: OidcEnv): URL {
  return new URL(`https://login.microsoftonline.com/${env.tenantId}/discovery/v2.0/keys`)
}

export async function verifyIdToken(idToken: string, env: OidcEnv): Promise<JWTPayload> {
  const JWKS = createRemoteJWKSet(jwksUrl(env))
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: env.issuer,
      audience: env.clientId,
    })
    assertOidcClaims(payload, env)
    return payload
  } catch (error) {
    if (error instanceof OidcError) throw error
    throw new OidcError(401, 'OidcInvalidToken', 'ID token could not be verified')
  }
}

function sanitizeUser(user: Record<string, unknown>) {
  const { password: _p, resetPasswordToken: _r, confirmationToken: _c, ...safe } = user
  return safe
}

export async function exchangeIdToken(
  strapi: Core.Strapi,
  idToken: string | undefined,
): Promise<{ jwt: string; user: Record<string, unknown> }> {
  const env = getOidcEnv()
  if (!env) {
    throw new OidcError(400, 'OidcNotConfigured', 'OIDC/Entra ID is not configured')
  }
  if (!idToken || typeof idToken !== 'string') {
    throw new OidcError(400, 'OidcInvalidToken', 'id_token is required')
  }

  const payload = await verifyIdToken(idToken, env)
  const email = emailFromClaims(payload)
  if (!email) {
    throw new OidcError(401, 'OidcInvalidToken', 'ID token has no email claim')
  }

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { email: { $eqi: email } },
    populate: ['role'],
  })

  if (!user) {
    throw new OidcError(403, 'OidcUserNotFound', 'No RCP user exists for this Microsoft account')
  }
  if (isAccountBlocked(user)) {
    throw new OidcError(403, 'OidcUserInactive', 'User is blocked')
  }

  const names = namesFromClaims(payload)
  const updates: Record<string, unknown> = {}
  if (names.first_name) updates.first_name = names.first_name
  if (names.last_name) updates.last_name = names.last_name

  const currentEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
  if (email !== currentEmail) {
    const taken = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email: { $eqi: email }, id: { $ne: user.id } },
      select: ['id'],
    })
    if (!taken) updates.email = email
  }

  let current = user
  if (Object.keys(updates).length) {
    current = await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: updates,
      populate: ['role'],
    })
  }

  await refreshLinkedEmployeeIdentity(strapi, current.id as number)

  const jwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: current.id })
  return { jwt, user: sanitizeUser(current as Record<string, unknown>) }
}

export class OidcError extends Error {
  status: number

  constructor(status: number, name: string, message: string) {
    super(message)
    this.name = name
    this.status = status
  }
}

export type OidcEnv = {
  issuer: string
  clientId: string
  tenantId: string
}

export type OidcClaims = {
  iss?: string
  aud?: string | string[]
  tid?: unknown
  exp?: number
  email?: unknown
  preferred_username?: unknown
}

export function emailFromClaims(payload: OidcClaims): string | null {
  const email = payload.email
  if (typeof email === 'string' && email.includes('@')) {
    return email.trim().toLowerCase()
  }
  const preferred = payload.preferred_username
  if (typeof preferred === 'string' && preferred.includes('@')) {
    return preferred.trim().toLowerCase()
  }
  return null
}

export function assertOidcClaims(payload: OidcClaims, env: OidcEnv): void {
  if (payload.iss !== env.issuer) {
    throw new OidcError(401, 'OidcInvalidToken', 'Token issuer does not match')
  }
  const audience = payload.aud
  const audOk = Array.isArray(audience)
    ? audience.includes(env.clientId)
    : audience === env.clientId
  if (!audOk) {
    throw new OidcError(401, 'OidcInvalidToken', 'Token audience does not match')
  }
  if (payload.tid !== env.tenantId) {
    throw new OidcError(401, 'OidcInvalidToken', 'Token tenant does not match')
  }
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new OidcError(401, 'OidcInvalidToken', 'Token has expired')
  }
}

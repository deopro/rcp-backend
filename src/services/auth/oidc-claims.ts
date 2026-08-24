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
  given_name?: unknown
  family_name?: unknown
  name?: unknown
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

function asTrimmedName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** given_name / family_name, else split the `name` claim. */
export function namesFromClaims(payload: OidcClaims): {
  first_name: string | null
  last_name: string | null
} {
  const given = asTrimmedName(payload.given_name)
  const family = asTrimmedName(payload.family_name)
  if (given || family) {
    return { first_name: given || null, last_name: family || null }
  }

  const display = asTrimmedName(payload.name)
  if (!display) return { first_name: null, last_name: null }

  const space = display.indexOf(' ')
  if (space === -1) return { first_name: display, last_name: null }
  return {
    first_name: display.slice(0, space).trim() || null,
    last_name: display.slice(space + 1).trim() || null,
  }
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

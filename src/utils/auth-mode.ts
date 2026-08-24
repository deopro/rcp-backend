// Auth mode: `local` (password) or `oidc` (Microsoft 365 + password).

export type AuthMode = 'local' | 'oidc'

export function getAuthMode(): AuthMode {
  const raw = (process.env.AUTH_MODE || 'local').toLowerCase()
  return raw === 'oidc' ? 'oidc' : 'local'
}

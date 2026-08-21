// Auth mode helper — local now; OIDC/Entra prepared for later milestones.

export type AuthMode = 'local' | 'oidc'

export function getAuthMode(): AuthMode {
  const mode = (process.env.AUTH_MODE || 'local').toLowerCase()
  return mode === 'oidc' ? 'oidc' : 'local'
}

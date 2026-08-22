import type { Core } from '@strapi/strapi'
import { registerOrgRoutes } from './services/org/register-routes'
import { registerProjectRoutes } from './services/projects/register-routes'
import { ensureOrgPermissions } from './services/rbac/ensure-org-permissions'
import { ensureProjectPermissions } from './services/rbac/ensure-project-permissions'
import { ensureUserRelationPermissions } from './services/rbac/ensure-user-relation-permissions'
import { ensureRcpRoles } from './services/rbac/ensure-roles'
import { getAuthMode } from './utils/auth-mode'

function sanitizeUser(user: Record<string, unknown>) {
  const { password: _p, resetPasswordToken: _r, confirmationToken: _c, ...safe } = user
  return safe
}

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  // Merge custom User fields (partial extensions/.../schema.json overrides core attrs).
  const userType = strapi.contentType('plugin::users-permissions.user')
  userType.attributes = {
    ...userType.attributes,
    preferred_locale: {
      type: 'enumeration',
      enum: ['pt-PT', 'en'],
      default: 'pt-PT',
    },
    status: {
      type: 'enumeration',
      enum: ['active', 'inactive'],
      default: 'active',
    },
  }

  registerOrgRoutes(strapi)
  registerProjectRoutes(strapi)

  // content-api routes get users-permissions JWT auth; default server.routes() uses type "api" (no strategy).
  strapi.server.routes({
    type: 'content-api',
    routes: [
    {
      method: 'GET',
      path: '/account/me',
      info: {},
      handler: async (ctx) => {
        const authUser = ctx.state.user as { id: number } | undefined
        // #region agent log
        fetch('http://host.docker.internal:7550/ingest/00e40e9f-34c6-4349-ac97-bfda2cfa152b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'805b23'},body:JSON.stringify({sessionId:'805b23',runId:'post-fix',hypothesisId:'H6',location:'index.ts:account-me-get',message:'account/me handler',data:{hasAuthUser:Boolean(authUser),authUserId:authUser?.id??null},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (!authUser) {
          return ctx.unauthorized('Authentication required')
        }

        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: authUser.id },
          populate: ['role'],
        })

        if (!user || user.status === 'inactive') {
          return ctx.unauthorized('User is inactive')
        }

        ctx.body = sanitizeUser(user as Record<string, unknown>)
      },
      config: {
        auth: {
          scope: [],
        },
      },
    },
    {
      method: 'PUT',
      path: '/account/me',
      info: {},
      handler: async (ctx) => {
        const authUser = ctx.state.user as { id: number } | undefined
        if (!authUser) {
          return ctx.unauthorized('Authentication required')
        }

        const body = ctx.request.body as { preferred_locale?: string }
        const preferredLocale = body?.preferred_locale
        if (preferredLocale !== 'pt-PT' && preferredLocale !== 'en') {
          return ctx.badRequest('preferred_locale must be pt-PT or en')
        }

        const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: authUser.id },
        })

        if (!existing || existing.status === 'inactive') {
          return ctx.unauthorized('User is inactive')
        }

        const updated = await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: authUser.id },
          data: { preferred_locale: preferredLocale },
          populate: ['role'],
        })

        ctx.body = sanitizeUser(updated as Record<string, unknown>)
      },
      config: {
        auth: {
          scope: [],
        },
      },
    },
    {
      method: 'GET',
      path: '/auth/oidc',
      info: {},
      handler: async (ctx) => {
        const mode = getAuthMode()
        ctx.status = mode === 'oidc' ? 501 : 400
        ctx.body = {
          error: {
            status: ctx.status,
            name: 'OidcNotConfigured',
            message:
              mode === 'oidc'
                ? 'OIDC/Entra ID mode is enabled but the provider is not configured yet. See ARCHITECTURE.md.'
                : 'AUTH_MODE is local. Set AUTH_MODE=oidc and configure OIDC_* env vars to use Entra ID.',
          },
        }
      },
      config: {
        auth: false,
      },
    },
    ],
  })
}

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.log.info(`RCP API ready (AUTH_MODE=${getAuthMode()})`)

  try {
    await ensureRcpRoles(strapi)
    await ensureOrgPermissions(strapi)
    await ensureProjectPermissions(strapi)
    await ensureUserRelationPermissions(strapi)
  } catch (error) {
    strapi.log.error('Failed to ensure RCP roles / permissions')
    strapi.log.error(error)
  }
}

export default {
  register,
  bootstrap,
}

import type { Core } from '@strapi/strapi'
import { registerAiRoutes } from './services/ai/register-routes'
import { registerAllocationRoutes } from './services/allocations/register-routes'
import { registerApprovalRoutes } from './services/approvals/register-routes'
import { registerBenchRoutes } from './services/bench/register-routes'
import { registerDashboardRoutes } from './services/dashboard/register-routes'
import { registerForecastRoutes } from './services/forecast/register-routes'
import { registerNotificationRoutes } from './services/notifications/register-routes'
import { registerOrgRoutes } from './services/org/register-routes'
import { registerProjectRoutes } from './services/projects/register-routes'
import { registerReportRoutes } from './services/reports/register-routes'
import { ensureAllocationPermissions } from './services/rbac/ensure-allocation-permissions'
import { ensureApprovalPermissions } from './services/rbac/ensure-approval-permissions'
import { ensureOrgPermissions } from './services/rbac/ensure-org-permissions'
import { ensureProjectPermissions } from './services/rbac/ensure-project-permissions'
import { ensureLeavePermissions } from './services/rbac/ensure-leave-permissions'
import { ensureSkillsPermissions } from './services/rbac/ensure-skills-permissions'
import { ensureUserRelationPermissions } from './services/rbac/ensure-user-relation-permissions'
import { ensureRcpRoles } from './services/rbac/ensure-roles'
import { syncEmployeeRoleUsers } from './utils/employee-scope'
import { getAuthMode } from './utils/auth-mode'
import { exchangeIdToken, OidcError } from './services/auth/oidc'

function sanitizeUser(user: Record<string, unknown>) {
  const { password: _p, resetPasswordToken: _r, confirmationToken: _c, ...safe } = user
  return safe
}

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  // Merge custom User fields (partial extensions/.../schema.json overrides core attrs).
  const userType = strapi.contentType('plugin::users-permissions.user')
  userType.attributes = {
    ...userType.attributes,
    first_name: {
      type: 'string',
    },
    last_name: {
      type: 'string',
    },
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

  const employeeType = strapi.contentType('api::employee.employee')
  employeeType.attributes = {
    ...employeeType.attributes,
    user: {
      type: 'relation',
      relation: 'oneToOne',
      target: 'plugin::users-permissions.user',
    },
  }

  const teamType = strapi.contentType('api::team.team')
  teamType.attributes = {
    ...teamType.attributes,
    team_leader: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::users-permissions.user',
    },
  }

  const departmentType = strapi.contentType('api::department.department')
  departmentType.attributes = {
    ...departmentType.attributes,
    manager: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::users-permissions.user',
    },
  }

  const leaveType = strapi.contentType('api::leave.leave')
  leaveType.attributes = {
    ...leaveType.attributes,
    reviewed_by: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::users-permissions.user',
    },
  }

  registerOrgRoutes(strapi)
  registerProjectRoutes(strapi)
  registerAllocationRoutes(strapi)
  registerBenchRoutes(strapi)
  registerApprovalRoutes(strapi)
  registerDashboardRoutes(strapi)
  registerForecastRoutes(strapi)
  registerAiRoutes(strapi)
  registerReportRoutes(strapi)
  registerNotificationRoutes(strapi)

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
      method: 'POST',
      path: '/auth/oidc/exchange',
      info: {},
      handler: async (ctx) => {
        const body = ctx.request.body as { id_token?: string }
        try {
          ctx.body = await exchangeIdToken(strapi, body?.id_token)
        } catch (error) {
          if (error instanceof OidcError) {
            ctx.status = error.status
            ctx.body = {
              error: {
                status: error.status,
                name: error.name,
                message: error.message,
              },
            }
            return
          }
          throw error
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
    await ensureSkillsPermissions(strapi)
    await ensureAllocationPermissions(strapi)
    await ensureLeavePermissions(strapi)
    await ensureApprovalPermissions(strapi)
    await ensureUserRelationPermissions(strapi)
    await syncEmployeeRoleUsers(strapi)
  } catch (error) {
    strapi.log.error('Failed to ensure RCP roles / permissions')
    strapi.log.error(error)
  }
}

export default {
  register,
  bootstrap,
}

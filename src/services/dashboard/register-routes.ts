/**
 * Dashboard KPI route.
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'
import { computeDashboard } from './calculate'

function num(value?: string): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function registerDashboardRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/dashboard',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const query = ctx.query as {
            from?: string
            to?: string
            department?: string
            team?: string
            project?: string
            employee?: string
          }

          if (!query.from || !query.to) {
            return ctx.badRequest('from and to query params are required (YYYY-MM-DD)')
          }

          const roleType = await resolveRoleType(strapi, user)
          const result = await computeDashboard(strapi, {
            from: query.from,
            to: query.to,
            userId: user.id,
            roleType,
            departmentId: num(query.department),
            teamId: num(query.team),
            projectId: num(query.project),
            employeeId: num(query.employee),
          })

          ctx.body = { data: result }
        },
        config: { auth: { scope: [] } },
      },
    ],
  })
}

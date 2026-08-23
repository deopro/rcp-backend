/**
 * Forecast API route.
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'
import {
  computeForecast,
  type ForecastGranularity,
  type ForecastScope,
} from './calculate'

function num(value?: string): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const SCOPES: ForecastScope[] = ['org', 'department', 'team', 'project']
const GRANULARITIES: ForecastGranularity[] = ['day', 'week', 'month']

export function registerForecastRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/forecast',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const query = ctx.query as {
            from?: string
            to?: string
            scope?: string
            granularity?: string
            department?: string
            team?: string
            project?: string
          }

          if (!query.from || !query.to) {
            return ctx.badRequest('from and to query params are required (YYYY-MM-DD)')
          }

          const roleType = await resolveRoleType(strapi, user)

          const scope = SCOPES.includes(query.scope as ForecastScope)
            ? (query.scope as ForecastScope)
            : 'org'

          const granularity = GRANULARITIES.includes(query.granularity as ForecastGranularity)
            ? (query.granularity as ForecastGranularity)
            : 'week'

          const result = await computeForecast(strapi, {
            from: query.from,
            to: query.to,
            scope,
            granularity,
            userId: user.id,
            roleType,
            departmentId: num(query.department),
            teamId: num(query.team),
            projectId: num(query.project),
          })

          ctx.body = { data: result }
        },
        config: { auth: { scope: [] } },
      },
    ],
  })
}

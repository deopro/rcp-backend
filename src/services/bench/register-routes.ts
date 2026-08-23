/**
 * Bench + forecast stub routes.
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'
import { computeBench, computeForecastStub } from './calculate'

function parseSkillIds(raw?: string | string[]): number[] {
  if (!raw) return []
  const parts = Array.isArray(raw) ? raw : String(raw).split(',')
  return parts
    .map((p) => Number(String(p).trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

export function registerBenchRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/bench',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const query = ctx.query as {
            from?: string
            to?: string
            team?: string
            skills?: string | string[]
            min_remaining?: string
          }

          if (!query.from || !query.to) {
            return ctx.badRequest('from and to query params are required (YYYY-MM-DD)')
          }

          const roleType = await resolveRoleType(strapi, user)
          const result = await computeBench(strapi, {
            from: query.from,
            to: query.to,
            teamId: query.team ? Number(query.team) : undefined,
            skillIds: parseSkillIds(query.skills),
            minRemaining: query.min_remaining ? Number(query.min_remaining) : undefined,
            userId: user.id,
            roleType,
          })

          ctx.body = { data: result }
        },
        config: { auth: { scope: [] } },
      },
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
            team?: string
          }

          if (!query.from || !query.to) {
            return ctx.badRequest('from and to query params are required (YYYY-MM-DD)')
          }

          const roleType = await resolveRoleType(strapi, user)
          const result = await computeForecastStub(strapi, {
            from: query.from,
            to: query.to,
            scope: query.scope,
            teamId: query.team ? Number(query.team) : undefined,
            userId: user.id,
            roleType,
          })

          ctx.body = { data: result }
        },
        config: { auth: { scope: [] } },
      },
    ],
  })
}

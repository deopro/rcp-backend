/**
 * Custom project routes (summary). Registered from src/index.ts.
 */
import type { Core } from '@strapi/strapi'
import { computeProjectSummary } from './summary'
import { canAccessProject } from '../../utils/employee-scope'
import { resolveRoleType } from '../../utils/resolve-role-type'

export function registerProjectRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
    {
      method: 'GET',
      path: '/projects/:documentId/summary',
      info: {},
      handler: async (ctx) => {
        const authUser = ctx.state.user as { id: number } | undefined
        if (!authUser) {
          return ctx.unauthorized()
        }

        const { documentId } = ctx.params as { documentId: string }
        const project = await strapi.db.query('api::project.project').findOne({
          where: { documentId },
          select: ['id'],
        })
        if (!project) {
          return ctx.notFound('Project not found')
        }

        const roleType = await resolveRoleType(strapi, authUser)
        const allowed = await canAccessProject(
          strapi,
          roleType,
          authUser.id,
          project.id as number,
        )
        if (!allowed) {
          return ctx.forbidden()
        }

        const summary = await computeProjectSummary(strapi, documentId)

        if (!summary) {
          return ctx.notFound('Project not found')
        }

        ctx.body = { data: summary }
      },
      config: {
        auth: {
          scope: [],
        },
      },
    },
    ],
  })
}

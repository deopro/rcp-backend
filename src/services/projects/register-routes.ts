/**
 * Custom project routes (summary). Registered from src/index.ts.
 */
import type { Core } from '@strapi/strapi'
import { computeProjectSummary } from './summary'

export function registerProjectRoutes(strapi: Core.Strapi) {
  strapi.server.routes([
    {
      method: 'GET',
      path: '/api/projects/:documentId/summary',
      handler: async (ctx) => {
        const authUser = ctx.state.user as { id: number } | undefined
        if (!authUser) {
          return ctx.unauthorized()
        }

        const { documentId } = ctx.params as { documentId: string }
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
  ])
}

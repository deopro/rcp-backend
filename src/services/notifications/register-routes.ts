/**
 * Notifications API routes.
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'
import { scanNotificationAlerts } from './alerts'
import { listNotifications, markAllRead, markRead } from './create'
import { getVapidPublicKey } from './push-provider'

const SCAN_ROLES = ['administrator', 'executive', 'department_manager', 'team_leader'] as const

export function registerNotificationRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/notifications',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const query = ctx.query as { unread?: string; limit?: string }
          const result = await listNotifications(strapi, user.id, {
            unreadOnly: query.unread === '1' || query.unread === 'true',
            limit: query.limit ? Number(query.limit) : 50,
          })

          ctx.body = { data: result.items, meta: { unread_count: result.unread_count } }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'GET',
        path: '/notifications/unread-count',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const result = await listNotifications(strapi, user.id, { limit: 1 })
          ctx.body = { data: { unread_count: result.unread_count } }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'POST',
        path: '/notifications/:documentId/read',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const { documentId } = ctx.params as { documentId: string }
          const updated = await markRead(strapi, user.id, documentId)
          if (!updated) return ctx.notFound()
          ctx.body = { data: updated }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'POST',
        path: '/notifications/read-all',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const count = await markAllRead(strapi, user.id)
          ctx.body = { data: { marked: count } }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'POST',
        path: '/notifications/scan',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const roleType = await resolveRoleType(strapi, user)
          if (!roleType || !SCAN_ROLES.includes(roleType as (typeof SCAN_ROLES)[number])) {
            return ctx.forbidden()
          }

          const body = ctx.request.body as { from?: string; to?: string }
          const result = await scanNotificationAlerts(strapi, {
            userId: user.id,
            roleType,
            from: body?.from,
            to: body?.to,
          })

          ctx.body = { data: result }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'GET',
        path: '/notifications/push/vapid-public-key',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          ctx.body = {
            data: {
              configured: Boolean(getVapidPublicKey()),
              public_key: getVapidPublicKey(),
            },
          }
        },
        config: { auth: { scope: [] } },
      },
    ],
  })
}

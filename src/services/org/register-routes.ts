/**
 * Lightweight user list for org assignment dropdowns (manager, team leader, employee↔user).
 * Registered from src/index.ts — keep out of api routes folders (Strapi auto-loads those as core routers).
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'

const ASSIGNMENT_ROLES = new Set([
  'administrator',
  'executive',
  'department_manager',
  'team_leader',
])

export function registerOrgRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
    {
      method: 'GET',
      path: '/org/user-options',
      info: {},
      handler: async (ctx) => {
        const authUser = ctx.state.user as
          | { id: number; role?: { type?: string } }
          | undefined

        if (!authUser) {
          return ctx.unauthorized()
        }

        const roleType = await resolveRoleType(strapi, authUser)
        if (!roleType || !ASSIGNMENT_ROLES.has(roleType)) {
          return ctx.forbidden()
        }

        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { blocked: { $ne: true } },
          select: ['id', 'username', 'email', 'first_name', 'last_name'],
          orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }, { email: 'asc' }],
          limit: 500,
        })

        ctx.body = {
          data: users.map((u) => ({
            id: u.id,
            username: u.username,
            email: u.email,
            first_name: u.first_name ?? null,
            last_name: u.last_name ?? null,
          })),
        }
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

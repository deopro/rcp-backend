/**
 * Employee controller — validates daily_capacity and scopes lists by role.
 */
import { factories } from '@strapi/strapi'
import { resolveRoleType } from '../../../utils/resolve-role-type'

const DEFAULT_CAPACITY = 8

function normalizeCapacity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_CAPACITY
  }
  return Math.min(24, Math.max(0.5, n))
}

export default factories.createCoreController('api::employee.employee', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    if (roleType === 'employee') {
      ctx.query.filters = {
        $and: [filters, { user: { id: { $eq: user.id } } }],
      }
    } else if (roleType === 'team_leader') {
      ctx.query.filters = {
        $and: [filters, { team: { team_leader: { id: { $eq: user.id } } } }],
      }
    } else if (roleType === 'department_manager') {
      ctx.query.filters = {
        $and: [
          filters,
          { team: { department: { manager: { id: { $eq: user.id } } } } },
        ],
      }
    }

    return await super.find(ctx)
  },

  async create(ctx) {
    const body = ctx.request.body as { data?: Record<string, unknown> }
    if (body?.data) {
      body.data.daily_capacity = normalizeCapacity(body.data.daily_capacity ?? DEFAULT_CAPACITY)
    }
    return await super.create(ctx)
  },

  async update(ctx) {
    const body = ctx.request.body as { data?: Record<string, unknown> }
    if (body?.data && body.data.daily_capacity !== undefined) {
      body.data.daily_capacity = normalizeCapacity(body.data.daily_capacity)
    }
    return await super.update(ctx)
  },
}))

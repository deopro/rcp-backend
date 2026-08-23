/**
 * Employee controller — validates daily_capacity and scopes lists by role.
 */
import { factories } from '@strapi/strapi'
import {
  canAccessEmployee,
  canAssignEmployeeToTeam,
  extractRelationId,
  scopeEmployeeFilters,
} from '../../../utils/employee-scope'
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

    ctx.query.filters = await scopeEmployeeFilters(strapi, roleType, user.id, filters)

    return await super.find(ctx)
  },

  async findOne(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::employee.employee').findOne({
      where: { documentId },
      select: ['id'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)
    const allowed = await canAccessEmployee(
      strapi,
      roleType,
      user.id,
      existing.id as number,
    )
    if (!allowed) return ctx.forbidden()

    return await super.findOne(ctx)
  },

  async create(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const body = ctx.request.body as { data?: Record<string, unknown> }
    const roleType = await resolveRoleType(strapi, user)
    const teamId = body?.data ? extractRelationId(body.data, 'team') : null

    if (roleType === 'team_leader' || roleType === 'department_manager') {
      const allowed = await canAssignEmployeeToTeam(strapi, roleType, user.id, teamId)
      if (!allowed) return ctx.forbidden('Employee must belong to an authorized team')
    }

    if (body?.data) {
      body.data.daily_capacity = normalizeCapacity(body.data.daily_capacity ?? DEFAULT_CAPACITY)
    }
    return await super.create(ctx)
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const body = ctx.request.body as { data?: Record<string, unknown> }

    const existing = await strapi.db.query('api::employee.employee').findOne({
      where: { documentId },
      populate: ['team'],
      select: ['id'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)
    const allowed = await canAccessEmployee(
      strapi,
      roleType,
      user.id,
      existing.id as number,
    )
    if (!allowed) return ctx.forbidden()

    if (body?.data && (roleType === 'team_leader' || roleType === 'department_manager')) {
      const teamId =
        extractRelationId(body.data, 'team') ?? (existing.team?.id as number | undefined) ?? null
      const teamAllowed = await canAssignEmployeeToTeam(strapi, roleType, user.id, teamId)
      if (!teamAllowed) return ctx.forbidden('Employee must belong to an authorized team')
    }

    if (body?.data && body.data.daily_capacity !== undefined) {
      body.data.daily_capacity = normalizeCapacity(body.data.daily_capacity)
    }

    return await super.update(ctx)
  },
}))

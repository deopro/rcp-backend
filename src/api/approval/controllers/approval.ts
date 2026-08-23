/**
 * Approval controller — list scoping + create validation.
 */
import { factories } from '@strapi/strapi'
import { scopeTeamRelationFilters } from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'

function relationId(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const v = value as { connect?: number[]; id?: number }
    if (Array.isArray(v.connect) && v.connect[0]) return v.connect[0]
    if (v.id) return v.id
  }
  return undefined
}

export default factories.createCoreController('api::approval.approval', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    if (roleType === 'team_leader' || roleType === 'department_manager') {
      ctx.query.filters = await scopeTeamRelationFilters(
        strapi,
        roleType,
        user.id,
        filters,
      )
    } else if (roleType === 'employee') {
      ctx.body = {
        data: [],
        meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } },
      }
      return
    }

    return await super.find(ctx)
  },

  async create(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'employee' || roleType === 'executive') {
      return ctx.forbidden()
    }

    const body = ctx.request.body as { data?: Record<string, unknown> }
    if (!body?.data) return ctx.badRequest('data is required')

    const start = body.data.period_start as string | undefined
    const end = body.data.period_end as string | undefined
    if (!start || !end) return ctx.badRequest('period_start and period_end are required')
    if (new Date(end) < new Date(start)) {
      return ctx.badRequest('period_end must be on or after period_start')
    }

    const teamId = relationId(body.data.team)
    if (!teamId) return ctx.badRequest('team is required')

    if (roleType === 'team_leader') {
      const team = await strapi.db.query('api::team.team').findOne({
        where: { id: teamId },
        populate: ['team_leader'],
      })
      if (!team || team.team_leader?.id !== user.id) {
        return ctx.forbidden('Not authorized for this team')
      }
    }

    if (roleType === 'department_manager') {
      const team = await strapi.db.query('api::team.team').findOne({
        where: { id: teamId },
        populate: ['department.manager'],
      })
      if (!team || team.department?.manager?.id !== user.id) {
        return ctx.forbidden('Not authorized for this team')
      }
    }

    body.data.status = 'draft'
    return await super.create(ctx)
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::approval.approval').findOne({
      where: { documentId },
    })
    if (!existing) return ctx.notFound()

    if (existing.status === 'locked') {
      return ctx.badRequest('PERIOD_LOCKED', { code: 'PERIOD_LOCKED' })
    }

    // Direct status changes go through workflow routes
    const body = ctx.request.body as { data?: Record<string, unknown> }
    if (body?.data?.status) {
      delete body.data.status
    }

    return await super.update(ctx)
  },

  async delete(ctx) {
    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::approval.approval').findOne({
      where: { documentId },
    })
    if (!existing) return ctx.notFound()
    if (existing.status === 'locked' || existing.status === 'approved') {
      return ctx.badRequest('Cannot delete approved or locked periods')
    }
    return await super.delete(ctx)
  },
}))

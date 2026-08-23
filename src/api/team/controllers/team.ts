/**
 * Team controller with role-based scoping.
 */
import { factories } from '@strapi/strapi'
import { findTeamIdsForLeader, scopeTeamFilters } from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'

export default factories.createCoreController('api::team.team', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    ctx.query.filters = await scopeTeamFilters(strapi, roleType, user.id, filters)

    return await super.find(ctx)
  },

  async findOne(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::team.team').findOne({
      where: { documentId },
      select: ['id'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') {
      const teamIds = await findTeamIdsForLeader(strapi, user.id)
      if (!teamIds.includes(existing.id as number)) return ctx.forbidden()
    }

    return await super.findOne(ctx)
  },

  async create(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') return ctx.forbidden()

    return await super.create(ctx)
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') return ctx.forbidden()

    return await super.update(ctx)
  },

  async delete(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') return ctx.forbidden()

    return await super.delete(ctx)
  },
}))

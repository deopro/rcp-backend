/**
 * Team controller with role-based scoping.
 */
import { factories } from '@strapi/strapi'
import { scopeTeamFilters } from '../../../utils/employee-scope'
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
}))

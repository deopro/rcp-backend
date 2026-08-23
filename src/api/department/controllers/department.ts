/**
 * Department controller — managers only see departments they manage (plus read-all for exec/admin).
 */
import { factories } from '@strapi/strapi'
import { scopeDepartmentFilters } from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'

export default factories.createCoreController('api::department.department', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    ctx.query.filters = await scopeDepartmentFilters(strapi, roleType, user.id, filters)

    return await super.find(ctx)
  },
}))

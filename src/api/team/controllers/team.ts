/**
 * Team controller with role-based scoping.
 * - team_leader: only teams where they are team_leader
 * - department_manager: teams in departments they manage
 * - admin/executive: all teams
 */
import { factories } from '@strapi/strapi'
import { resolveRoleType } from '../../../utils/resolve-role-type'

export default factories.createCoreController('api::team.team', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    if (roleType === 'team_leader') {
      ctx.query.filters = {
        $and: [filters, { team_leader: { id: { $eq: user.id } } }],
      }
    } else if (roleType === 'department_manager') {
      ctx.query.filters = {
        $and: [filters, { department: { manager: { id: { $eq: user.id } } } }],
      }
    } else if (roleType === 'employee') {
      const employee = await strapi.db.query('api::employee.employee').findOne({
        where: { user: user.id },
        populate: ['team'],
      })
      const teamId = employee?.team?.id
      if (!teamId) {
        ctx.body = {
          data: [],
          meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } },
        }
        return
      }
      ctx.query.filters = {
        $and: [filters, { id: { $eq: teamId } }],
      }
    }

    return await super.find(ctx)
  },
}))

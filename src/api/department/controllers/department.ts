/**
 * Department controller — managers only see departments they manage (plus read-all for exec/admin).
 */
import { factories } from '@strapi/strapi'
import { resolveRoleType } from '../../../utils/resolve-role-type'

export default factories.createCoreController('api::department.department', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    if (roleType === 'department_manager') {
      ctx.query.filters = {
        $and: [filters, { manager: { id: { $eq: user.id } } }],
      }
    } else if (roleType === 'team_leader') {
      const teams = await strapi.db.query('api::team.team').findMany({
        where: { team_leader: user.id },
        populate: ['department'],
      })
      const ids = [...new Set(teams.map((t) => t.department?.id).filter(Boolean))]
      ctx.query.filters = {
        $and: [filters, { id: { $in: ids.length ? ids : [-1] } }],
      }
    } else if (roleType === 'employee') {
      const employee = await strapi.db.query('api::employee.employee').findOne({
        where: { user: user.id },
        populate: ['team.department'],
      })
      const deptId = employee?.team?.department?.id
      ctx.query.filters = {
        $and: [filters, { id: { $eq: deptId ?? -1 } }],
      }
    }

    return await super.find(ctx)
  },
}))

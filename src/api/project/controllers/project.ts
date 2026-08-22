/**
 * Project controller — validates dates and scopes lists by role.
 */
import { factories } from '@strapi/strapi'
import { resolveRoleType } from '../../../utils/resolve-role-type'

function validateDates(body: { data?: Record<string, unknown> }) {
  const start = body?.data?.start_date as string | undefined
  const end = body?.data?.end_date as string | undefined
  if (start && end && new Date(end) < new Date(start)) {
    return 'end_date must be on or after start_date'
  }
  return null
}

export default factories.createCoreController('api::project.project', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    if (roleType === 'employee') {
      ctx.query.filters = {
        $and: [filters, { assigned_employees: { user: { id: { $eq: user.id } } } }],
      }
    } else if (roleType === 'team_leader') {
      ctx.query.filters = {
        $and: [
          filters,
          { assigned_employees: { team: { team_leader: { id: { $eq: user.id } } } } },
        ],
      }
    } else if (roleType === 'department_manager') {
      ctx.query.filters = {
        $and: [
          filters,
          {
            assigned_employees: {
              team: { department: { manager: { id: { $eq: user.id } } } },
            },
          },
        ],
      }
    }

    return await super.find(ctx)
  },

  async create(ctx) {
    const error = validateDates(ctx.request.body as { data?: Record<string, unknown> })
    if (error) {
      return ctx.badRequest(error)
    }
    return await super.create(ctx)
  },

  async update(ctx) {
    const error = validateDates(ctx.request.body as { data?: Record<string, unknown> })
    if (error) {
      return ctx.badRequest(error)
    }
    return await super.update(ctx)
  },
}))

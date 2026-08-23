/**
 * Project controller — validates dates, scopes lists by role,
 * and assigns sequential codes (RCP0001, RCP0002, …) on create.
 */
import { factories } from '@strapi/strapi'
import { allocateNextProjectCode } from '../../../services/projects/project-code'
import { scopeProjectFilters } from '../../../utils/employee-scope'
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

    ctx.query.filters = await scopeProjectFilters(strapi, roleType, user.id, filters)

    return await super.find(ctx)
  },

  async create(ctx) {
    const body = ctx.request.body as { data?: Record<string, unknown> }
    const error = validateDates(body)
    if (error) {
      return ctx.badRequest(error)
    }

    // Always assign the next sequential code server-side (RCP0001, RCP0002, …).
    body.data = body.data || {}
    body.data.code = await allocateNextProjectCode(strapi)

    return await super.create(ctx)
  },

  async update(ctx) {
    const body = ctx.request.body as { data?: Record<string, unknown> }
    const error = validateDates(body)
    if (error) {
      return ctx.badRequest(error)
    }

    // Codes are system-generated and immutable.
    if (body?.data && 'code' in body.data) {
      delete body.data.code
    }

    return await super.update(ctx)
  },
}))

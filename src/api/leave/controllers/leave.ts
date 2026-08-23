/**
 * Leave controller — request flow + role scoping.
 * Only approved leave reduces capacity (see capacity/calculate.ts).
 */
import { factories } from '@strapi/strapi'
import { scopeEmployeeRelationFilters } from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'
const LEAVE_TYPES = new Set(['annual', 'sick', 'unpaid', 'other'])
const STATUSES = new Set(['pending', 'approved', 'rejected'])

function relationId(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const v = value as { connect?: number[]; id?: number }
    if (Array.isArray(v.connect) && v.connect[0]) return v.connect[0]
    if (v.id) return v.id
  }
  return undefined
}

function validateDates(start?: string, end?: string): string | null {
  if (!start || !end) return 'start_date and end_date are required'
  if (new Date(end) < new Date(start)) return 'end_date must be on or after start_date'
  return null
}

export default factories.createCoreController('api::leave.leave', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    ctx.query.filters = await scopeEmployeeRelationFilters(
      strapi,
      roleType,
      user.id,
      'employee',
      filters,
    )

    return await super.find(ctx)  },

  async create(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const body = ctx.request.body as { data?: Record<string, unknown> }
    if (!body?.data) return ctx.badRequest('data is required')

    const start = body.data.start_date as string | undefined
    const end = body.data.end_date as string | undefined
    const dateError = validateDates(start, end)
    if (dateError) return ctx.badRequest(dateError)

    const leaveType = body.data.leave_type as string | undefined
    if (leaveType && !LEAVE_TYPES.has(leaveType)) {
      return ctx.badRequest('Invalid leave_type')
    }

    const roleType = await resolveRoleType(strapi, user)

    // Employees may only request leave for themselves, always as pending
    if (roleType === 'employee') {
      const own = await strapi.db.query('api::employee.employee').findOne({
        where: { user: user.id },
      })
      if (!own) return ctx.badRequest('No employee record linked to this user')
      body.data.employee = own.id
      body.data.status = 'pending'
      body.data.reviewed_by = null
      body.data.reviewed_at = null
    } else {
      const status = (body.data.status as string) || 'pending'
      if (!STATUSES.has(status)) return ctx.badRequest('Invalid status')
      body.data.status = status
      if (status === 'approved' || status === 'rejected') {
        body.data.reviewed_by = user.id
        body.data.reviewed_at = new Date().toISOString()
      }
    }

    return await super.create(ctx)
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const body = ctx.request.body as { data?: Record<string, unknown> }
    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::leave.leave').findOne({
      where: { documentId },
      populate: ['employee'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)

    if (roleType === 'employee') {
      const own = await strapi.db.query('api::employee.employee').findOne({
        where: { user: user.id },
      })
      if (!own || existing.employee?.id !== own.id) {
        return ctx.forbidden()
      }
      // Employees can only edit pending requests (not status)
      if (existing.status !== 'pending') {
        return ctx.badRequest('Only pending leave can be edited')
      }
      if (body?.data) {
        delete body.data.status
        delete body.data.reviewed_by
        delete body.data.reviewed_at
        delete body.data.employee
      }
    }

    if (body?.data?.start_date || body?.data?.end_date) {
      const start = (body.data.start_date as string) || existing.start_date
      const end = (body.data.end_date as string) || existing.end_date
      const dateError = validateDates(start, end)
      if (dateError) return ctx.badRequest(dateError)
    }

    if (body?.data?.leave_type && !LEAVE_TYPES.has(body.data.leave_type as string)) {
      return ctx.badRequest('Invalid leave_type')
    }

    if (body?.data?.status && STATUSES.has(body.data.status as string)) {
      if (roleType === 'employee') {
        return ctx.forbidden('Employees cannot change leave status')
      }
      const next = body.data.status as string
      if (next === 'approved' || next === 'rejected') {
        body.data.reviewed_by = user.id
        body.data.reviewed_at = new Date().toISOString()
      }
    }

    return await super.update(ctx)
  },
}))

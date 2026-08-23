/**
 * Leave controller — request flow + role scoping.
 * Only approved leave reduces capacity (see capacity/calculate.ts).
 */
import { factories } from '@strapi/strapi'
import {
  canAccessLeaveEmployee,
  ensureEmployeeForUser,
  findEmployeeIdForUser,
  scopeEmployeeRelationFilters,
} from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'

const LEAVE_TYPES = new Set(['annual', 'sick', 'unpaid', 'other'])
const STATUSES = new Set(['pending', 'approved', 'rejected'])

function validateDates(start?: string, end?: string): string | null {
  if (!start || !end) return 'start_date and end_date are required'
  if (new Date(end) < new Date(start)) return 'end_date must be on or after start_date'
  return null
}

function paginationFromQuery(query: Record<string, unknown> | undefined) {
  const raw = query?.pagination as Record<string, unknown> | undefined
  const page = Math.max(1, Number(raw?.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(raw?.pageSize) || 25))
  return { page, pageSize }
}

function toLeaveResponse(row: Record<string, unknown>) {
  const employee = row.employee as Record<string, unknown> | undefined
  return {
    id: row.id,
    documentId: row.documentId,
    start_date: row.start_date,
    end_date: row.end_date,
    leave_type: row.leave_type,
    status: row.status,
    notes: row.notes ?? null,
    reviewed_at: row.reviewed_at ?? null,
    employee: employee
      ? {
          id: employee.id,
          documentId: employee.documentId,
          full_name: employee.full_name,
        }
      : null,
  }
}

export default factories.createCoreController('api::leave.leave', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }
    const { page, pageSize } = paginationFromQuery(ctx.query as Record<string, unknown>)

    if (roleType === 'employee') {
      const employeeId = await findEmployeeIdForUser(strapi, user.id)
      if (!employeeId) {
        ctx.body = {
          data: [],
          meta: { pagination: { page: 1, pageSize, pageCount: 0, total: 0 } },
        }
        return
      }

      const where = { employee: employeeId }
      const [rows, total] = await Promise.all([
        strapi.db.query('api::leave.leave').findMany({
          where,
          populate: ['employee'],
          orderBy: { start_date: 'desc' },
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        strapi.db.query('api::leave.leave').count({ where }),
      ])

      ctx.body = {
        data: rows.map((row) => toLeaveResponse(row as Record<string, unknown>)),
        meta: {
          pagination: {
            page,
            pageSize,
            pageCount: Math.ceil(total / pageSize) || 0,
            total,
          },
        },
      }
      return
    }

    ctx.query.filters = await scopeEmployeeRelationFilters(
      strapi,
      roleType,
      user.id,
      'employee',
      filters,
    )

    return await super.find(ctx)
  },

  async findOne(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::leave.leave').findOne({
      where: { documentId },
      populate: ['employee'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)
    const allowed = await canAccessLeaveEmployee(
      strapi,
      roleType,
      user.id,
      existing.employee?.id as number | undefined,
    )
    if (!allowed) return ctx.forbidden()

    return await super.findOne(ctx)
  },

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

    if (roleType === 'team_leader') {
      return ctx.forbidden()
    }

    // Employees register pre-approved vacation days for themselves
    if (roleType === 'employee') {
      const employeeId = await ensureEmployeeForUser(strapi, user.id)
      if (!employeeId) return ctx.badRequest('No employee record linked to this user')
      body.data.employee = employeeId
      body.data.status = 'approved'
      body.data.leave_type = 'annual'
      delete body.data.reviewed_by
      delete body.data.reviewed_at
    } else {
      const status = (body.data.status as string) || 'pending'
      if (!STATUSES.has(status)) return ctx.badRequest('Invalid status')
      body.data.status = status
      if (status === 'approved' || status === 'rejected') {
        body.data.reviewed_by = user.id
        body.data.reviewed_at = new Date().toISOString()
      } else {
        delete body.data.reviewed_by
        delete body.data.reviewed_at
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
    const allowed = await canAccessLeaveEmployee(
      strapi,
      roleType,
      user.id,
      existing.employee?.id as number | undefined,
    )
    if (!allowed) return ctx.forbidden()

    if (roleType === 'team_leader') {
      return ctx.forbidden()
    }

    if (roleType === 'employee') {
      if (body?.data) {
        delete body.data.status
        delete body.data.reviewed_by
        delete body.data.reviewed_at
        delete body.data.employee
        body.data.leave_type = 'annual'
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

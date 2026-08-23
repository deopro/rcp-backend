/**
 * Allocation controller — capacity validation, role scoping, period locks.
 */
import { factories } from '@strapi/strapi'
import { scopeEmployeeRelationFilters } from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'
import {
  assertUniqueAllocation,
  CapacityExceededError,
  extractAllocationFields,
  validateAllocationCapacity,
} from '../../../services/allocations/validate'
import {
  assertAllocationNotLocked,
  PeriodLockedError,
} from '../../../services/approvals/lock'

function capacityErrorResponse(
  ctx: { badRequest: (response?: string | object, details?: object) => unknown },
  err: CapacityExceededError,
) {
  return ctx.badRequest('CAPACITY_EXCEEDED', {
    code: 'CAPACITY_EXCEEDED',
    employee_id: err.employeeId,
    date: err.date,
    capacity: err.capacity,
    allocated: err.allocated,
    requested: err.requested,
    excess: Math.round((err.allocated + err.requested - err.capacity) * 100) / 100,
  })
}

function lockedErrorResponse(
  ctx: { badRequest: (response?: string | object, details?: object) => unknown },
  err: PeriodLockedError,
) {
  return ctx.badRequest('PERIOD_LOCKED', {
    code: 'PERIOD_LOCKED',
    team_id: err.teamId,
    date: err.date,
  })
}

export default factories.createCoreController('api::allocation.allocation', ({ strapi }) => ({
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

    return await super.find(ctx)
  },

  async create(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    const body = ctx.request.body as { data?: Record<string, unknown> }
    const fields = extractAllocationFields(body?.data || {})

    if (!fields.employeeId || !fields.projectId || !fields.date || !fields.hours) {
      return ctx.badRequest('employee, project, allocation_date, and hours are required')
    }
    if (fields.hours <= 0) {
      return ctx.badRequest('hours must be greater than 0')
    }

    try {
      await assertAllocationNotLocked(strapi, fields.employeeId, fields.date)
    } catch (e) {
      if (e instanceof PeriodLockedError) return lockedErrorResponse(ctx, e)
      throw e
    }

    const dup = await assertUniqueAllocation(
      strapi,
      fields.employeeId,
      fields.projectId,
      fields.date,
    )
    if (dup) return ctx.badRequest(dup)

    try {
      await validateAllocationCapacity(strapi, fields.employeeId, fields.date, fields.hours)
    } catch (e) {
      if (e instanceof CapacityExceededError) return capacityErrorResponse(ctx, e)
      throw e
    }

    if (body?.data && user) {
      body.data.created_by = user.id
      body.data.updated_by = user.id
      if (!body.data.status) body.data.status = 'draft'
    }

    return await super.create(ctx)
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    const documentId = ctx.params.id as string
    const body = ctx.request.body as { data?: Record<string, unknown> }

    const existing = await strapi.db.query('api::allocation.allocation').findOne({
      where: { documentId },
      populate: ['employee', 'project'],
    })
    if (!existing) return ctx.notFound()

    const incoming = extractAllocationFields({ ...existing, ...body?.data })
    const employeeId = incoming.employeeId || existing.employee?.id
    const projectId = incoming.projectId || existing.project?.id
    const date = incoming.date || existing.allocation_date
    const hours = incoming.hours || Number(existing.hours)

    try {
      await assertAllocationNotLocked(strapi, employeeId!, date!)
    } catch (e) {
      if (e instanceof PeriodLockedError) return lockedErrorResponse(ctx, e)
      throw e
    }

    if (employeeId && projectId && date) {
      const dup = await assertUniqueAllocation(strapi, employeeId, projectId, date, documentId)
      if (dup) return ctx.badRequest(dup)
    }

    try {
      await validateAllocationCapacity(strapi, employeeId!, date!, hours, existing.id)
    } catch (e) {
      if (e instanceof CapacityExceededError) return capacityErrorResponse(ctx, e)
      throw e
    }

    if (body?.data && user) {
      body.data.updated_by = user.id
    }

    return await super.update(ctx)
  },

  async delete(ctx) {
    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::allocation.allocation').findOne({
      where: { documentId },
      populate: ['employee'],
    })
    if (!existing) return ctx.notFound()

    try {
      await assertAllocationNotLocked(
        strapi,
        existing.employee?.id,
        existing.allocation_date,
      )
    } catch (e) {
      if (e instanceof PeriodLockedError) return lockedErrorResponse(ctx, e)
      throw e
    }

    return await super.delete(ctx)
  },
}))

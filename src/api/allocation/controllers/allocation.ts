/**
 * Allocation controller — capacity validation, role scoping, period locks.
 */
import { factories } from '@strapi/strapi'
import {
  canAccessEmployee,
  ensureEmployeeForUser,
  findEmployeeIdForUser,
  isEmployeeAssignedToProject,
  scopeEmployeeRelationFilters,
} from '../../../utils/employee-scope'
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
    if (!user) return ctx.unauthorized()

    const body = ctx.request.body as { data?: Record<string, unknown> }
    const fields = extractAllocationFields(body?.data || {})

    if (!fields.employeeId || !fields.projectId || !fields.date || !fields.hours) {
      return ctx.badRequest('employee, project, allocation_date, and hours are required')
    }
    if (fields.hours <= 0) {
      return ctx.badRequest('hours must be greater than 0')
    }

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'employee') {
      const ownId =
        (await findEmployeeIdForUser(strapi, user.id)) ??
        (await ensureEmployeeForUser(strapi, user.id))
      if (!ownId) return ctx.badRequest('No employee record linked to this user')
      if (fields.employeeId !== ownId) return ctx.forbidden()
      const assigned = await isEmployeeAssignedToProject(strapi, ownId, fields.projectId)
      if (!assigned) return ctx.forbidden('Project not assigned to this employee')
    } else if (roleType === 'team_leader' || roleType === 'department_manager') {
      const allowed = await canAccessEmployee(strapi, roleType, user.id, fields.employeeId)
      if (!allowed) return ctx.forbidden()
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

    const created = await strapi.db.query('api::allocation.allocation').create({
      data: {
        employee: fields.employeeId,
        project: fields.projectId,
        allocation_date: fields.date,
        hours: fields.hours,
        notes: fields.notes ?? null,
        status: fields.status || 'draft',
        created_by: user.id,
        updated_by: user.id,
      },
      populate: ['employee', 'project'],
    })
    ctx.body = { data: created }
    return ctx.body
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const body = ctx.request.body as { data?: Record<string, unknown> }

    const existing = await strapi.db.query('api::allocation.allocation').findOne({
      where: { documentId },
      populate: ['employee', 'project'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'employee') {
      const ownId = await findEmployeeIdForUser(strapi, user.id)
      if (!ownId || existing.employee?.id !== ownId) return ctx.forbidden()
      if (existing.status !== 'draft') {
        return ctx.badRequest('Only draft allocations can be edited')
      }
      if (body?.data) {
        delete body.data.employee
        delete body.data.status
      }
    } else if (roleType === 'team_leader' || roleType === 'department_manager') {
      const allowed = await canAccessEmployee(
        strapi,
        roleType,
        user.id,
        existing.employee?.id as number,
      )
      if (!allowed) return ctx.forbidden()
    }

    const incoming = extractAllocationFields({ ...existing, ...body?.data })
    const employeeId = incoming.employeeId || existing.employee?.id
    const projectId = incoming.projectId || existing.project?.id
    const date = incoming.date || existing.allocation_date
    const hours = incoming.hours || Number(existing.hours)

    if (roleType === 'employee') {
      const projectId = incoming.projectId || existing.project?.id
      if (projectId) {
        const ownId = await findEmployeeIdForUser(strapi, user.id)
        const assigned =
          ownId != null && (await isEmployeeAssignedToProject(strapi, ownId, projectId))
        if (!assigned) return ctx.forbidden('Project not assigned to this employee')
      }
    }

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

    const updateData: Record<string, unknown> = {
      allocation_date: date,
      hours,
      notes: incoming.notes !== undefined ? incoming.notes : existing.notes,
      updated_by: user.id,
    }
    if (roleType !== 'employee') {
      updateData.employee = employeeId
      updateData.project = projectId
      if (incoming.status) updateData.status = incoming.status
    } else if (projectId) {
      updateData.project = projectId
    }

    const updated = await strapi.db.query('api::allocation.allocation').update({
      where: { documentId },
      data: updateData,
      populate: ['employee', 'project'],
    })
    ctx.body = { data: updated }
    return ctx.body
  },

  async delete(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::allocation.allocation').findOne({
      where: { documentId },
      populate: ['employee'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'employee') {
      const ownId = await findEmployeeIdForUser(strapi, user.id)
      if (!ownId || existing.employee?.id !== ownId) return ctx.forbidden()
      if (existing.status !== 'draft') {
        return ctx.badRequest('Only draft allocations can be deleted')
      }
    } else if (roleType === 'team_leader' || roleType === 'department_manager') {
      const allowed = await canAccessEmployee(
        strapi,
        roleType,
        user.id,
        existing.employee?.id as number,
      )
      if (!allowed) return ctx.forbidden()
    }

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

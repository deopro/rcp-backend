/**
 * Allocation validation — daily capacity guard (server-authoritative).
 */
import type { Core } from '@strapi/strapi'
import { extractRelationId } from '../../utils/employee-scope'

export class CapacityExceededError extends Error {
  code = 'CAPACITY_EXCEEDED'
  employeeId: number
  date: string
  capacity: number
  allocated: number
  requested: number

  constructor(
    employeeId: number,
    date: string,
    capacity: number,
    allocated: number,
    requested: number,
  ) {
    super('CAPACITY_EXCEEDED')
    this.employeeId = employeeId
    this.date = date
    this.capacity = capacity
    this.allocated = allocated
    this.requested = requested
  }
}

export async function sumDailyHours(
  strapi: Core.Strapi,
  employeeId: number,
  date: string,
  excludeAllocationId?: number,
): Promise<number> {
  const where: Record<string, unknown> = {
    employee: employeeId,
    allocation_date: date,
  }
  if (excludeAllocationId) {
    where.id = { $ne: excludeAllocationId }
  }

  const rows = await strapi.db.query('api::allocation.allocation').findMany({ where })
  return rows.reduce((sum: number, r: { hours?: number }) => sum + Number(r.hours || 0), 0)
}

export async function validateAllocationCapacity(
  strapi: Core.Strapi,
  employeeId: number,
  date: string,
  hours: number,
  excludeAllocationId?: number,
): Promise<void> {
  const employee = await strapi.db.query('api::employee.employee').findOne({
    where: { id: employeeId },
  })
  if (!employee) {
    throw new Error('Employee not found')
  }

  const capacity = Number(employee.daily_capacity ?? 8)
  const existing = await sumDailyHours(strapi, employeeId, date, excludeAllocationId)
  const total = existing + hours

  if (total > capacity + 0.001) {
    throw new CapacityExceededError(employeeId, date, capacity, existing, hours)
  }
}

export async function assertUniqueAllocation(
  strapi: Core.Strapi,
  employeeId: number,
  projectId: number,
  date: string,
  excludeDocumentId?: string,
): Promise<string | null> {
  const where: Record<string, unknown> = {
    employee: employeeId,
    project: projectId,
    allocation_date: date,
  }
  if (excludeDocumentId) {
    where.documentId = { $ne: excludeDocumentId }
  }

  const existing = await strapi.db.query('api::allocation.allocation').findOne({ where })
  if (existing) {
    return 'An allocation already exists for this employee, project, and date'
  }
  return null
}

export function extractAllocationFields(data: Record<string, unknown>) {
  return {
    employeeId: extractRelationId(data, 'employee') ?? undefined,
    projectId: extractRelationId(data, 'project') ?? undefined,
    date: data.allocation_date as string | undefined,
    hours: Number(data.hours),
    notes: data.notes as string | undefined,
    status: data.status as string | undefined,
  }
}

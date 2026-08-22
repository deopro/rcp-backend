/**
 * Copy allocations from yesterday or previous week.
 */
import type { Core } from '@strapi/strapi'
import { addDays, parseIsoDate, previousWeekday, toIsoDate } from '../capacity/working-days'
import {
  assertUniqueAllocation,
  CapacityExceededError,
  validateAllocationCapacity,
} from './validate'

export type CopyMode = 'yesterday' | 'previous_week'

export async function copyAllocations(
  strapi: Core.Strapi,
  opts: {
    targetDate: string
    mode: CopyMode
    employeeIds?: number[]
    userId?: number
  },
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const target = parseIsoDate(opts.targetDate)
  let sourceFrom: Date
  let sourceTo: Date

  if (opts.mode === 'yesterday') {
    const source = previousWeekday(target)
    sourceFrom = source
    sourceTo = source
  } else {
    sourceFrom = addDays(target, -7)
    sourceTo = addDays(target, -7)
  }

  const sourceFromIso = toIsoDate(sourceFrom)
  const sourceToIso = toIsoDate(sourceTo)
  const targetIso = toIsoDate(target)

  const where: Record<string, unknown> = {
    allocation_date: { $gte: sourceFromIso, $lte: sourceToIso },
  }
  if (opts.employeeIds?.length) {
    where.employee = { id: { $in: opts.employeeIds } }
  }

  const sourceRows = await strapi.db.query('api::allocation.allocation').findMany({
    where,
    populate: ['employee', 'project'],
  })

  let created = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of sourceRows) {
    const employeeId = row.employee?.id
    const projectId = row.project?.id
    if (!employeeId || !projectId) {
      skipped++
      continue
    }

    const dup = await assertUniqueAllocation(strapi, employeeId, projectId, targetIso)
    if (dup) {
      skipped++
      continue
    }

    const hours = Number(row.hours)
    try {
      await validateAllocationCapacity(strapi, employeeId, targetIso, hours)
    } catch (e) {
      if (e instanceof CapacityExceededError) {
        errors.push(`CAPACITY_EXCEEDED:${employeeId}:${targetIso}`)
        skipped++
        continue
      }
      throw e
    }

    await strapi.db.query('api::allocation.allocation').create({
      data: {
        employee: employeeId,
        project: projectId,
        allocation_date: targetIso,
        hours,
        notes: row.notes,
        status: 'draft',
        created_by: opts.userId,
        updated_by: opts.userId,
      },
    })
    created++
  }

  return { created, skipped, errors }
}

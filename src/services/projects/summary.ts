/**
 * Project capacity summary — weekdays only until holidays/leave (M6/M7).
 */
import type { Core } from '@strapi/strapi'

export type ProjectSummary = {
  project_id: number
  document_id: string
  from: string | null
  to: string | null
  working_days: number
  assigned_count: number
  capacity_hours: number
  allocated_hours: number
  remaining_hours: number
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function countWeekdays(from: Date, to: Date): number {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)

  if (end < start) return 0

  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export async function computeProjectSummary(
  strapi: Core.Strapi,
  projectDocumentId: string,
): Promise<ProjectSummary | null> {
  const project = await strapi.db.query('api::project.project').findOne({
    where: { documentId: projectDocumentId },
    populate: ['assigned_employees'],
  })

  if (!project) return null

  const start = parseDate(project.start_date) || new Date()
  const end = parseDate(project.end_date) || start
  const workingDays = countWeekdays(start, end)

  const employees = (project.assigned_employees || []).filter(
    (e: { status?: string }) => e.status !== 'inactive',
  )

  const capacityHours = employees.reduce((sum: number, employee: { daily_capacity?: number }) => {
    const daily = Number(employee.daily_capacity ?? 8)
    return sum + workingDays * daily
  }, 0)

  // Allocations arrive in Milestone 6 — sum hours on assigned employees in project date range.
  let allocatedHours = 0
  if (employees.length && project.start_date && project.end_date) {
    const empIds = employees.map((e: { id: number }) => e.id)
    const rows = await strapi.db.query('api::allocation.allocation').findMany({
      where: {
        employee: { id: { $in: empIds } },
        allocation_date: { $gte: project.start_date, $lte: project.end_date },
      },
    })
    allocatedHours = rows.reduce((sum: number, r: { hours?: number }) => sum + Number(r.hours || 0), 0)
  }

  return {
    project_id: project.id,
    document_id: project.documentId,
    from: project.start_date || null,
    to: project.end_date || null,
    working_days: workingDays,
    assigned_count: employees.length,
    capacity_hours: Math.round(capacityHours * 100) / 100,
    allocated_hours: allocatedHours,
    remaining_hours: Math.round((capacityHours - allocatedHours) * 100) / 100,
  }
}

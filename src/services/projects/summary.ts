/**
 * Project capacity summary — working days exclude weekends and holidays.
 * Leave is employee-specific so project-level capacity uses holidays only.
 */
import type { Core } from '@strapi/strapi'
import { loadHolidayDates } from '../capacity/calculate'
import { countWorkingDays, parseIsoDate, toIsoDate } from '../capacity/working-days'

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

export { countWeekdays } from '../capacity/working-days'

export async function computeProjectSummary(
  strapi: Core.Strapi,
  projectDocumentId: string,
): Promise<ProjectSummary | null> {
  const project = await strapi.db.query('api::project.project').findOne({
    where: { documentId: projectDocumentId },
    populate: ['assigned_employees'],
  })

  if (!project) return null

  const start = project.start_date ? parseIsoDate(project.start_date) : new Date()
  const end = project.end_date ? parseIsoDate(project.end_date) : start
  const fromIso = toIsoDate(start)
  const toIso = toIsoDate(end)

  const holidayDates = await loadHolidayDates(strapi, fromIso, toIso)
  const workingDays = countWorkingDays(start, end, holidayDates)

  const employees = (project.assigned_employees || []).filter(
    (e: { status?: string }) => e.status !== 'inactive',
  )

  const capacityHours = employees.reduce((sum: number, employee: { daily_capacity?: number }) => {
    const daily = Number(employee.daily_capacity ?? 8)
    return sum + workingDays * daily
  }, 0)

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

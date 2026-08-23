/**
 * Period lock checks — locked approvals make allocations immutable.
 */
import type { Core } from '@strapi/strapi'

export class PeriodLockedError extends Error {
  code = 'PERIOD_LOCKED'
  teamId: number
  date: string

  constructor(teamId: number, date: string) {
    super('PERIOD_LOCKED')
    this.teamId = teamId
    this.date = date
  }
}

export async function findLockedApprovalForTeamDate(
  strapi: Core.Strapi,
  teamId: number,
  date: string,
) {
  return strapi.db.query('api::approval.approval').findOne({
    where: {
      status: 'locked',
      team: teamId,
      period_start: { $lte: date },
      period_end: { $gte: date },
    },
  })
}

export async function assertAllocationNotLocked(
  strapi: Core.Strapi,
  employeeId: number,
  date: string,
): Promise<void> {
  const employee = await strapi.db.query('api::employee.employee').findOne({
    where: { id: employeeId },
    populate: ['team'],
  })
  const teamId = employee?.team?.id as number | undefined
  if (!teamId) return

  const locked = await findLockedApprovalForTeamDate(strapi, teamId, date)
  if (locked) {
    throw new PeriodLockedError(teamId, date)
  }
}

export async function markAllocationsSubmitted(
  strapi: Core.Strapi,
  teamId: number,
  periodStart: string,
  periodEnd: string,
) {
  const employees = await strapi.db.query('api::employee.employee').findMany({
    where: { team: teamId },
  })
  const ids = employees.map((e: { id: number }) => e.id)
  if (!ids.length) return 0

  const rows = await strapi.db.query('api::allocation.allocation').findMany({
    where: {
      employee: { id: { $in: ids } },
      allocation_date: { $gte: periodStart, $lte: periodEnd },
      status: 'draft',
    },
  })

  for (const row of rows) {
    await strapi.db.query('api::allocation.allocation').update({
      where: { id: row.id },
      data: { status: 'submitted' },
    })
  }
  return rows.length
}

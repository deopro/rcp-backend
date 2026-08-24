/**
 * Capacity / bench / missing-allocation alert scans.
 */
import type { Core } from '@strapi/strapi'
import { computeCapacity } from '../capacity/calculate'
import { computeBench } from '../bench/calculate'
import { toIsoDate } from '../capacity/working-days'
import { createNotification } from './create'

function yesterdayIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return toIsoDate(d)
}

function daysAgoIso(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toIsoDate(d)
}

async function notifyManagersForEmployee(
  strapi: Core.Strapi,
  employeeId: number,
  input: { type: 'over_allocation' | 'missing_allocation' | 'bench_alert' | 'capacity_alert'; title: string; body: string; dedupeKey: string; payload: Record<string, unknown> },
): Promise<number> {
  const employee = await strapi.db.query('api::employee.employee').findOne({
    where: { id: employeeId },
    populate: ['team', 'team.team_leader', 'team.department.manager', 'user'],
  })
  if (!employee) return 0

  const recipients = new Set<number>()
  const leaderId = employee.team?.team_leader?.id as number | undefined
  const managerId = employee.team?.department?.manager?.id as number | undefined
  const selfUserId = employee.user?.id as number | undefined

  if (leaderId) recipients.add(leaderId)
  if (managerId) recipients.add(managerId)
  if (input.type === 'missing_allocation' && selfUserId) recipients.add(selfUserId)

  let created = 0
  for (const userId of recipients) {
    const result = await createNotification(strapi, {
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      payload: {
        ...input.payload,
        employee_id: employeeId,
        employee_name: employee.full_name,
        team_id: employee.team?.id,
        team_name: employee.team?.name,
      },
      dedupeKey: input.dedupeKey,
    })
    if (result) created += 1
  }
  return created
}

export async function scanNotificationAlerts(
  strapi: Core.Strapi,
  opts: {
    userId: number
    roleType: string | null
    from?: string
    to?: string
  },
): Promise<{ created: number; scanned_employees: number }> {
  const to = opts.to || yesterdayIso()
  const from = opts.from || daysAgoIso(7)

  const capacity = await computeCapacity(strapi, {
    from,
    to,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  let created = 0

  for (const emp of capacity.employees) {
    for (const day of emp.days) {
      if (!day.is_working_day) continue

      if (day.allocated_hours > day.available_hours + 0.01) {
        created += await notifyManagersForEmployee(strapi, emp.employee_id, {
          type: 'over_allocation',
          title: `Over-allocation — ${emp.full_name}`,
          body: `${day.allocated_hours}h allocated on ${day.date} (capacity ${day.available_hours}h).`,
          dedupeKey: `over:${emp.employee_id}:${day.date}`,
          payload: {
            date: day.date,
            allocated: day.allocated_hours,
            available: day.available_hours,
            employee_name: emp.full_name,
            link: '/allocations',
          },
        })
      }

      if (day.available_hours > 0 && day.allocated_hours === 0) {
        created += await notifyManagersForEmployee(strapi, emp.employee_id, {
          type: 'missing_allocation',
          title: `Missing allocation — ${emp.full_name}`,
          body: `No hours logged on working day ${day.date}.`,
          dedupeKey: `missing:${emp.employee_id}:${day.date}`,
          payload: { date: day.date, employee_name: emp.full_name, link: '/allocations' },
        })
      }
    }
  }

  const bench = await computeBench(strapi, {
    from,
    to,
    userId: opts.userId,
    roleType: opts.roleType,
    minRemaining: 16,
  })

  for (const emp of bench.employees) {
    if (emp.remaining_hours < 16) continue
    created += await notifyManagersForEmployee(strapi, emp.employee_id, {
      type: 'bench_alert',
      title: `Bench available — ${emp.full_name}`,
      body: `${emp.remaining_hours}h remaining (${emp.bench_pct}% bench) in ${from} → ${to}.`,
      dedupeKey: `bench:${emp.employee_id}:${from}:${to}`,
      payload: {
        remaining_hours: emp.remaining_hours,
        bench_pct: emp.bench_pct,
        from,
        to,
        employee_name: emp.full_name,
        link: '/bench',
      },
    })
  }

  // Org-level capacity summary for managers when utilization is extreme
  const totalAvailable = capacity.employees.reduce(
    (s, e) => s + e.days.reduce((a, d) => a + d.available_hours, 0),
    0,
  )
  const totalAllocated = capacity.employees.reduce(
    (s, e) => s + e.days.reduce((a, d) => a + d.allocated_hours, 0),
    0,
  )
  const utilization = totalAvailable > 0 ? (totalAllocated / totalAvailable) * 100 : 0

  if (utilization > 95 || utilization < 40) {
    const result = await createNotification(strapi, {
      userId: opts.userId,
      type: 'capacity_alert',
      title: utilization > 95 ? 'High utilization alert' : 'Low utilization alert',
      body: `Scope utilization is ${Math.round(utilization * 10) / 10}% for ${from} → ${to}.`,
      payload: {
        from,
        to,
        level: utilization > 95 ? 'high' : 'low',
        utilization_pct: Math.round(utilization * 10) / 10,
        link: '/',
      },
      dedupeKey: `capacity:${opts.userId}:${from}:${to}:${Math.round(utilization)}`,
    })
    if (result) created += 1
  }

  return { created, scanned_employees: capacity.employees.length }
}

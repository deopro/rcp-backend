/**
 * Bench = remaining capacity in a window (available − allocated).
 * Optional skill filter keeps employees who have any of the requested skills.
 */
import type { Core } from '@strapi/strapi'
import { computeCapacity, type CapacityResult } from '../capacity/calculate'

export type BenchSkill = {
  id: number
  name: string
  proficiency_level?: string
}

export type BenchEmployee = {
  employee_id: number
  document_id: string
  full_name: string
  team_id?: number | null
  team_name?: string | null
  available_hours: number
  allocated_hours: number
  remaining_hours: number
  utilization_pct: number
  bench_pct: number
  skills: BenchSkill[]
}

export type BenchResult = {
  from: string
  to: string
  skill_ids: number[]
  team_id?: number | null
  totals: {
    employees: number
    available_hours: number
    allocated_hours: number
    remaining_hours: number
    utilization_pct: number
    bench_pct: number
  }
  employees: BenchEmployee[]
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

async function loadEmployeeSkills(
  strapi: Core.Strapi,
  employeeIds: number[],
): Promise<Map<number, BenchSkill[]>> {
  const map = new Map<number, BenchSkill[]>()
  if (!employeeIds.length) return map

  const rows = await strapi.db.query('api::employee-skill.employee-skill').findMany({
    where: { employee: { id: { $in: employeeIds } } },
    populate: ['employee', 'skill'],
  })

  for (const row of rows) {
    const empId = row.employee?.id as number | undefined
    const skill = row.skill as { id: number; name: string } | undefined
    if (!empId || !skill) continue
    const list = map.get(empId) || []
    list.push({
      id: skill.id,
      name: skill.name,
      proficiency_level: row.proficiency_level,
    })
    map.set(empId, list)
  }
  return map
}

export async function computeBench(
  strapi: Core.Strapi,
  opts: {
    from: string
    to: string
    teamId?: number
    skillIds?: number[]
    userId?: number
    roleType?: string | null
    minRemaining?: number
  },
): Promise<BenchResult> {
  const capacity: CapacityResult = await computeCapacity(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  const empIds = capacity.employees.map((e) => e.employee_id)
  const skillsByEmployee = await loadEmployeeSkills(strapi, empIds)
  const skillFilter = new Set(opts.skillIds || [])
  const minRemaining = opts.minRemaining ?? 0.01

  const employees: BenchEmployee[] = []

  for (const row of capacity.employees) {
    const skills = skillsByEmployee.get(row.employee_id) || []

    if (skillFilter.size > 0) {
      const hasSkill = skills.some((s) => skillFilter.has(s.id))
      if (!hasSkill) continue
    }

    const available = row.days.reduce((s, d) => s + d.available_hours, 0)
    const allocated = row.days.reduce((s, d) => s + d.allocated_hours, 0)
    const remaining = Math.max(0, Math.round((available - allocated) * 100) / 100)

    if (remaining < minRemaining) continue

    employees.push({
      employee_id: row.employee_id,
      document_id: row.document_id,
      full_name: row.full_name,
      team_id: row.team_id,
      team_name: row.team_name,
      available_hours: Math.round(available * 100) / 100,
      allocated_hours: Math.round(allocated * 100) / 100,
      remaining_hours: remaining,
      utilization_pct: pct(allocated, available),
      bench_pct: pct(remaining, available),
      skills,
    })
  }

  employees.sort((a, b) => b.remaining_hours - a.remaining_hours)

  const totalsAvailable = employees.reduce((s, e) => s + e.available_hours, 0)
  const totalsAllocated = employees.reduce((s, e) => s + e.allocated_hours, 0)
  const totalsRemaining = employees.reduce((s, e) => s + e.remaining_hours, 0)

  return {
    from: capacity.from,
    to: capacity.to,
    skill_ids: [...skillFilter],
    team_id: opts.teamId ?? null,
    totals: {
      employees: employees.length,
      available_hours: Math.round(totalsAvailable * 100) / 100,
      allocated_hours: Math.round(totalsAllocated * 100) / 100,
      remaining_hours: Math.round(totalsRemaining * 100) / 100,
      utilization_pct: pct(totalsAllocated, totalsAvailable),
      bench_pct: pct(totalsRemaining, totalsAvailable),
    },
    employees,
  }
}

/**
 * Forecast stub for Milestone 11 — returns current bench snapshot + placeholder series.
 */
export async function computeForecastStub(
  strapi: Core.Strapi,
  opts: {
    from: string
    to: string
    scope?: string
    teamId?: number
    userId?: number
    roleType?: string | null
  },
) {
  const bench = await computeBench(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    userId: opts.userId,
    roleType: opts.roleType,
  })

  return {
    status: 'stub' as const,
    milestone: 11,
    message:
      'Forecast API is prepared. Full week/month forecasting ships in Milestone 11. Current bench is returned as the baseline.',
    scope: opts.scope || 'org',
    from: opts.from,
    to: opts.to,
    baseline: {
      remaining_hours: bench.totals.remaining_hours,
      utilization_pct: bench.totals.utilization_pct,
      bench_pct: bench.totals.bench_pct,
      employees: bench.totals.employees,
    },
    series: [] as { date: string; remaining_hours: number; utilization_pct: number }[],
  }
}

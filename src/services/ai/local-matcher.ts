/**
 * Rule-based resource matching — skills + bench availability (authoritative scoring).
 */
import type { Core } from '@strapi/strapi'
import { randomUUID } from 'node:crypto'
import { computeBench } from '../bench/calculate'
import { canAccessProject } from '../../utils/employee-scope'
import type { RecommendationInput, RecommendationMatch } from './provider'
import { proficiencyWeight } from './provider'

const PROFICIENCY_RANK: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
  expert: 4,
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

type RequiredSkill = { id: number; name: string }

async function loadEmployeeSkillMap(
  strapi: Core.Strapi,
  employeeIds: number[],
): Promise<
  Map<
    number,
    { skill_id: number; skill_name: string; proficiency_level?: string | null }[]
  >
> {
  const map = new Map<
    number,
    { skill_id: number; skill_name: string; proficiency_level?: string | null }[]
  >()
  if (!employeeIds.length) return map

  const rows = await strapi.db.query('api::employee-skill.employee-skill').findMany({
    where: { employee: { id: { $in: employeeIds } } },
    populate: ['employee', 'skill'],
  })

  for (const row of rows) {
    const empId = row.employee?.id as number | undefined
    const skill = row.skill as { id?: number; name?: string } | undefined
    if (!empId || !skill?.id) continue
    const list = map.get(empId) || []
    list.push({
      skill_id: skill.id,
      skill_name: skill.name || `#${skill.id}`,
      proficiency_level: row.proficiency_level,
    })
    map.set(empId, list)
  }
  return map
}

function scoreEmployee(
  requiredSkills: RequiredSkill[],
  employeeSkills: { skill_id: number; skill_name: string; proficiency_level?: string | null }[],
  remainingHours: number,
  benchPct: number,
) {
  const matched_skills = requiredSkills.map((req) => {
    const found = employeeSkills.find((s) => s.skill_id === req.id)
    return {
      skill_id: req.id,
      skill_name: req.name,
      required: true,
      has_skill: Boolean(found),
      proficiency_level: found?.proficiency_level ?? null,
    }
  })

  const missing_skills = matched_skills
    .filter((s) => !s.has_skill)
    .map((s) => ({ skill_id: s.skill_id, skill_name: s.skill_name }))

  let skillPoints = 0
  const skillMax = requiredSkills.length || 1
  for (const req of requiredSkills) {
    const found = employeeSkills.find((s) => s.skill_id === req.id)
    if (found) skillPoints += proficiencyWeight(found.proficiency_level)
  }

  const skill_score = requiredSkills.length === 0 ? 100 : pct(skillPoints, skillMax)
  const availability_score = Math.min(100, Math.round(benchPct * 10) / 10)
  const score = Math.round((skill_score * 0.6 + availability_score * 0.4) * 10) / 10

  const reasons: string[] = []
  const matched = matched_skills.filter((s) => s.has_skill)
  if (matched.length) {
    const top = [...matched].sort(
      (a, b) =>
        (PROFICIENCY_RANK[b.proficiency_level || ''] || 0) -
        (PROFICIENCY_RANK[a.proficiency_level || ''] || 0),
    )[0]
    if (top) reasons.push(`SKILL_MATCH:${top.skill_name}:${top.proficiency_level || 'unknown'}`)
  }
  if (missing_skills.length) {
    reasons.push(`SKILL_GAP:${missing_skills.map((s) => s.skill_name).join(',')}`)
  } else if (!requiredSkills.length) {
    reasons.push('NO_REQUIRED_SKILLS')
  }
  reasons.push(`BENCH:${remainingHours}h`)
  reasons.push(`UTILIZATION_HEADROOM:${availability_score}%`)

  return { skill_score, availability_score, score, matched_skills, missing_skills, reasons }
}

export type StoredRecommendation = {
  id: string
  userId: number
  projectId: number
  projectDocumentId: string
  from: string
  to: string
  matches: RecommendationMatch[]
  createdAt: number
}

const sessions = new Map<string, StoredRecommendation>()
const SESSION_TTL_MS = 60 * 60 * 1000

export function storeRecommendation(session: StoredRecommendation): string {
  sessions.set(session.id, session)
  return session.id
}

export function getRecommendation(id: string): StoredRecommendation | undefined {
  const session = sessions.get(id)
  if (!session) return undefined
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id)
    return undefined
  }
  return session
}

export function removeRecommendation(id: string): void {
  sessions.delete(id)
}

export async function matchResources(
  strapi: Core.Strapi,
  opts: RecommendationInput & { userId: number; roleType: string | null },
): Promise<{
  session: StoredRecommendation
  summary: { candidates: number; avg_utilization_pct: number; total_remaining_hours: number }
} | null> {
  const project = await strapi.db.query('api::project.project').findOne({
    where: { id: opts.projectId },
    populate: ['required_skills'],
  })
  if (!project) return null

  const allowed = await canAccessProject(strapi, opts.roleType, opts.userId, project.id)
  if (!allowed) return null

  const requiredSkills: RequiredSkill[] = (project.required_skills || []).map(
    (s: { id: number; name?: string }) => ({ id: s.id, name: s.name || `#${s.id}` }),
  )

  const bench = await computeBench(strapi, {
    from: opts.from,
    to: opts.to,
    teamId: opts.teamId,
    userId: opts.userId,
    roleType: opts.roleType,
    minRemaining: 0.01,
  })

  const skillMap = await loadEmployeeSkillMap(
    strapi,
    bench.employees.map((e) => e.employee_id),
  )

  const matches: RecommendationMatch[] = bench.employees.map((emp) => {
    const scored = scoreEmployee(
      requiredSkills,
      skillMap.get(emp.employee_id) || [],
      emp.remaining_hours,
      emp.bench_pct,
    )
    return {
      employee_id: emp.employee_id,
      document_id: emp.document_id,
      full_name: emp.full_name,
      team_name: emp.team_name,
      remaining_hours: emp.remaining_hours,
      bench_pct: emp.bench_pct,
      ...scored,
    }
  })

  matches.sort((a, b) => b.score - a.score)
  const top = matches.slice(0, opts.limit ?? 8)

  const session: StoredRecommendation = {
    id: randomUUID(),
    userId: opts.userId,
    projectId: project.id,
    projectDocumentId: project.documentId,
    from: opts.from,
    to: opts.to,
    matches: top,
    createdAt: Date.now(),
  }
  storeRecommendation(session)

  return {
    session,
    summary: {
      candidates: bench.employees.length,
      avg_utilization_pct: pct(bench.totals.allocated_hours, bench.totals.available_hours),
      total_remaining_hours: bench.totals.remaining_hours,
    },
  }
}

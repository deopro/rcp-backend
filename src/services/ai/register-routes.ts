/**
 * AI recommendation routes — advisory only; apply is explicit.
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'
import { validateAllocationCapacity, CapacityExceededError } from '../allocations/validate'
import { assertAllocationNotLocked, PeriodLockedError } from '../approvals/lock'
import { createAiProvider } from './openai-provider'
import { logAiUsage } from './usage-log'
import { getRecommendation, matchResources, removeRecommendation } from './local-matcher'
import type { RecommendationResult } from './provider'

const AI_ROLES = ['administrator', 'executive', 'department_manager', 'team_leader'] as const

function num(value: unknown): number | undefined {
  if (value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function canUseAi(roleType: string | null): boolean {
  return Boolean(roleType && AI_ROLES.includes(roleType as (typeof AI_ROLES)[number]))
}

function templateReasons(reasons: string[], locale: string): string[] {
  const pt = locale.startsWith('pt')
  return reasons.map((code) => {
    if (code.startsWith('SKILL_MATCH:')) {
      const [, skill, level] = code.split(':')
      return pt ? `Competência ${skill} (${level})` : `Skill ${skill} (${level})`
    }
    if (code.startsWith('SKILL_GAP:')) {
      return pt
        ? `Competências em falta: ${code.slice('SKILL_GAP:'.length)}`
        : `Missing skills: ${code.slice('SKILL_GAP:'.length)}`
    }
    if (code.startsWith('BENCH:')) {
      const hours = code.slice('BENCH:'.length)
      return pt ? `${hours} de banco disponíveis` : `${hours} bench hours available`
    }
    if (code === 'NO_REQUIRED_SKILLS') {
      return pt ? 'Sem competências obrigatórias no projeto' : 'No required skills on project'
    }
    if (code.startsWith('UTILIZATION_HEADROOM:')) {
      const pct = code.slice('UTILIZATION_HEADROOM:'.length)
      return pt ? `${pct} de margem de capacidade` : `${pct} capacity headroom`
    }
    return code
  })
}

export function registerAiRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
      {
        method: 'POST',
        path: '/ai/recommendations',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number; preferred_locale?: string } | undefined
          if (!user) return ctx.unauthorized()

          const roleType = await resolveRoleType(strapi, user)
          if (!canUseAi(roleType)) return ctx.forbidden()

          const body = ctx.request.body as {
            project_id?: number
            from?: string
            to?: string
            team_id?: number
            limit?: number
            locale?: string
          }

          const projectId = num(body?.project_id)
          if (!projectId || !body?.from || !body?.to) {
            return ctx.badRequest('project_id, from, and to are required')
          }

          const result = await matchResources(strapi, {
            projectId,
            from: body.from,
            to: body.to,
            teamId: num(body.team_id),
            limit: num(body.limit) || 8,
            userId: user.id,
            roleType,
          })

          if (!result) return ctx.notFound('Project not found or not accessible')

          const provider = createAiProvider()
          const locale = body.locale || user.preferred_locale || 'en'

          const matches = await Promise.all(
            result.session.matches.map(async (match) => {
              const explanation = await provider.enhanceExplanation(match, locale).catch(() => '')
              return {
                ...match,
                reasons: templateReasons(match.reasons, locale),
                explanation: explanation || undefined,
              }
            }),
          )

          result.session.matches = matches

          await logAiUsage(strapi, {
            userId: user.id,
            provider: provider.name,
            operation: 'recommend',
            metadata: {
              project_id: projectId,
              from: body.from,
              to: body.to,
              match_count: matches.length,
            },
          })

          const project = await strapi.db.query('api::project.project').findOne({
            where: { id: projectId },
          })

          const payload: RecommendationResult = {
            recommendation_id: result.session.id,
            project_id: projectId,
            project_document_id: result.session.projectDocumentId,
            project_name: project?.name || '',
            from: body.from,
            to: body.to,
            provider: provider.name,
            matches,
            availability_summary: result.summary,
          }

          ctx.body = { data: payload }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'POST',
        path: '/ai/recommendations/:recommendationId/apply',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const roleType = await resolveRoleType(strapi, user)
          if (!canUseAi(roleType)) return ctx.forbidden()

          const { recommendationId } = ctx.params as { recommendationId: string }
          const body = ctx.request.body as {
            employee_id?: number
            allocation_date?: string
            hours?: number
            notes?: string
          }

          const employeeId = num(body?.employee_id)
          const hours = num(body?.hours)
          if (!employeeId || !body?.allocation_date || !hours) {
            return ctx.badRequest('employee_id, allocation_date, and hours are required')
          }

          const session = getRecommendation(recommendationId)
          if (!session || session.userId !== user.id) {
            return ctx.notFound('Recommendation session not found or expired')
          }

          if (!session.matches.some((m) => m.employee_id === employeeId)) {
            return ctx.badRequest('Employee was not part of this recommendation')
          }

          try {
            await assertAllocationNotLocked(strapi, employeeId, body.allocation_date)
            await validateAllocationCapacity(strapi, employeeId, body.allocation_date, hours)
          } catch (e) {
            if (e instanceof PeriodLockedError) {
              return ctx.badRequest('PERIOD_LOCKED', { code: 'PERIOD_LOCKED' })
            }
            if (e instanceof CapacityExceededError) {
              return ctx.badRequest('CAPACITY_EXCEEDED', { code: 'CAPACITY_EXCEEDED' })
            }
            throw e
          }

          const created = await strapi.db.query('api::allocation.allocation').create({
            data: {
              employee: employeeId,
              project: session.projectId,
              allocation_date: body.allocation_date,
              hours,
              notes: body.notes || `AI recommendation ${recommendationId.slice(0, 8)}`,
              status: 'draft',
              created_by: user.id,
              updated_by: user.id,
              publishedAt: new Date(),
            },
          })

          await logAiUsage(strapi, {
            userId: user.id,
            provider: 'system',
            operation: 'apply',
            metadata: {
              recommendation_id: recommendationId,
              employee_id: employeeId,
              project_id: session.projectId,
              allocation_id: created.id,
              hours,
              date: body.allocation_date,
            },
          })

          removeRecommendation(recommendationId)

          ctx.body = {
            data: {
              allocation_id: created.id,
              document_id: created.documentId,
              employee_id: employeeId,
              project_id: session.projectId,
              allocation_date: body.allocation_date,
              hours,
              status: 'draft',
            },
          }
        },
        config: { auth: { scope: [] } },
      },
    ],
  })
}

/**
 * Employee-skill controller — unique employee+skill and role-based scoping.
 */
import type { Core } from '@strapi/strapi'
import { factories } from '@strapi/strapi'
import {
  findEmployeeIdForUser,
  scopeEmployeeRelationFilters,
} from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'
const LEVELS = new Set(['basic', 'intermediate', 'advanced', 'expert'])

function normalizeLevel(value: unknown): string {
  const v = typeof value === 'string' ? value : 'basic'
  return LEVELS.has(v) ? v : 'basic'
}

function normalizeYears(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 10) / 10
}

function relationId(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const v = value as { connect?: number[]; id?: number }
    if (Array.isArray(v.connect) && v.connect[0]) return v.connect[0]
    if (v.id) return v.id
  }
  return undefined
}

async function assertUniquePair(
  strapi: Core.Strapi,
  employeeId: number,
  skillId: number,
  excludeDocumentId?: string,
) {
  const where: Record<string, unknown> = {
    employee: employeeId,
    skill: skillId,
  }
  if (excludeDocumentId) {
    where.documentId = { $ne: excludeDocumentId }
  }

  const existing = await strapi.db.query('api::employee-skill.employee-skill').findOne({ where })
  if (existing) {
    return 'This employee already has this skill recorded'
  }
  return null
}

export default factories.createCoreController('api::employee-skill.employee-skill', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

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
    const roleType = await resolveRoleType(strapi, user)

    if (roleType === 'employee') {
      const ownId = await findEmployeeIdForUser(strapi, user.id)
      if (!ownId) return ctx.badRequest('No employee record linked to this user')
      if (body?.data) {
        body.data.employee = ownId
      }
    }

    if (body?.data) {
      body.data.proficiency_level = normalizeLevel(body.data.proficiency_level)
      body.data.years_experience = normalizeYears(body.data.years_experience)

      const employeeId = relationId(body.data.employee)
      const skillId = relationId(body.data.skill)
      if (employeeId && skillId) {
        const dup = await assertUniquePair(strapi, employeeId, skillId)
        if (dup) return ctx.badRequest(dup)
      }
    }
    return await super.create(ctx)
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const body = ctx.request.body as { data?: Record<string, unknown> }
    const documentId = ctx.params.id as string

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'employee') {
      const existing = await strapi.db.query('api::employee-skill.employee-skill').findOne({
        where: { documentId },
        populate: ['employee'],
      })
      if (!existing) return ctx.notFound()
      const ownId = await findEmployeeIdForUser(strapi, user.id)
      if (!ownId || existing.employee?.id !== ownId) return ctx.forbidden()
      if (body?.data) {
        delete body.data.employee
      }
    }

    if (body?.data) {
      if (body.data.proficiency_level !== undefined) {
        body.data.proficiency_level = normalizeLevel(body.data.proficiency_level)
      }
      if (body.data.years_experience !== undefined) {
        body.data.years_experience = normalizeYears(body.data.years_experience)
      }

      const employeeId = relationId(body.data.employee)
      const skillId = relationId(body.data.skill)
      if (employeeId && skillId) {
        const dup = await assertUniquePair(strapi, employeeId, skillId, documentId)
        if (dup) return ctx.badRequest(dup)
      }
    }
    return await super.update(ctx)
  },

  async delete(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const roleType = await resolveRoleType(strapi, user)

    if (roleType === 'employee') {
      const existing = await strapi.db.query('api::employee-skill.employee-skill').findOne({
        where: { documentId },
        populate: ['employee'],
      })
      if (!existing) return ctx.notFound()
      const ownId = await findEmployeeIdForUser(strapi, user.id)
      if (!ownId || existing.employee?.id !== ownId) return ctx.forbidden()
    }

    return await super.delete(ctx)
  },
}))

/**
 * Team controller with role-based scoping.
 */
import { factories } from '@strapi/strapi'
import {
  extractRelationId,
  findTeamIdsForLeader,
  persistUserRelation,
  scopeTeamFilters,
} from '../../../utils/employee-scope'
import { resolveRoleType } from '../../../utils/resolve-role-type'

function mergePopulate(query: Record<string, unknown>, extra: Record<string, unknown>) {
  const current = query.populate
  if (!current || current === '*') {
    query.populate = extra
    return
  }
  if (typeof current === 'string') {
    query.populate = { [current]: true, ...extra }
    return
  }
  if (typeof current === 'object') {
    query.populate = { ...(current as object), ...extra }
  }
}

function resultDocumentId(result: unknown): string | undefined {
  const data = (result as { data?: { documentId?: string } } | undefined)?.data
  return data?.documentId
}

export default factories.createCoreController('api::team.team', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined
    if (!user) {
      return ctx.unauthorized()
    }

    const roleType = await resolveRoleType(strapi, user)
    const filters = { ...(ctx.query.filters as object | undefined) }

    ctx.query.filters = await scopeTeamFilters(strapi, roleType, user.id, filters)
    mergePopulate(ctx.query as Record<string, unknown>, { team_leader: true, department: true })

    return await super.find(ctx)
  },

  async findOne(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const documentId = ctx.params.id as string
    const existing = await strapi.db.query('api::team.team').findOne({
      where: { documentId },
      select: ['id'],
    })
    if (!existing) return ctx.notFound()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') {
      const teamIds = await findTeamIdsForLeader(strapi, user.id)
      if (!teamIds.includes(existing.id as number)) return ctx.forbidden()
    }

    mergePopulate(ctx.query as Record<string, unknown>, { team_leader: true, department: true })
    return await super.findOne(ctx)
  },

  async create(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') return ctx.forbidden()

    const body = ctx.request.body as { data?: Record<string, unknown> }
    const leaderId = body?.data ? extractRelationId(body.data, 'team_leader') : null
    if (body?.data && 'team_leader' in body.data) {
      delete body.data.team_leader
    }

    const result = await super.create(ctx)
    await persistUserRelation(
      strapi,
      'api::team.team',
      resultDocumentId(result),
      'team_leader',
      leaderId,
    )
    return result
  },

  async update(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') return ctx.forbidden()

    const body = ctx.request.body as { data?: Record<string, unknown> }
    const leaderId = body?.data ? extractRelationId(body.data, 'team_leader') : null
    if (body?.data && 'team_leader' in body.data) {
      delete body.data.team_leader
    }

    const result = await super.update(ctx)
    await persistUserRelation(
      strapi,
      'api::team.team',
      resultDocumentId(result) ?? (ctx.params.id as string),
      'team_leader',
      leaderId,
    )
    return result
  },

  async delete(ctx) {
    const user = ctx.state.user as { id: number } | undefined
    if (!user) return ctx.unauthorized()

    const roleType = await resolveRoleType(strapi, user)
    if (roleType === 'team_leader') return ctx.forbidden()

    return await super.delete(ctx)
  },
}))

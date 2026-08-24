/**

 * Employee controller — validates daily_capacity and scopes lists by role.

 */

import { factories } from '@strapi/strapi'

import {

  canAccessEmployee,

  canAssignEmployeeToTeam,

  extractRelationId,

  findDuplicateEmployeeEmail,

  findDuplicateEmployeeNumber,

  normalizeEmployeeNumber,

  overlayEmployeeIdentityFromUser,

  persistUserRelation,

  scopeEmployeeFilters,

} from '../../../utils/employee-scope'

import { resolveRoleType } from '../../../utils/resolve-role-type'



function resultDocumentId(result: unknown): string | undefined {

  const data = (result as { data?: { documentId?: string } } | undefined)?.data

  return data?.documentId

}



const DEFAULT_CAPACITY = 8



function normalizeCapacity(value: unknown): number {

  const n = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(n) || n <= 0) {

    return DEFAULT_CAPACITY

  }

  return Math.min(24, Math.max(0.5, n))

}



export default factories.createCoreController('api::employee.employee', ({ strapi }) => ({

  async find(ctx) {

    const user = ctx.state.user as { id: number; role?: { type?: string } } | undefined

    if (!user) {

      return ctx.unauthorized()

    }



    const roleType = await resolveRoleType(strapi, user)

    const filters = { ...(ctx.query.filters as object | undefined) }



    ctx.query.filters = await scopeEmployeeFilters(strapi, roleType, user.id, filters)

    ctx.query.populate = { team: true, user: true }



    return await super.find(ctx)

  },



  async findOne(ctx) {

    const user = ctx.state.user as { id: number } | undefined

    if (!user) return ctx.unauthorized()



    const documentId = ctx.params.id as string

    const existing = await strapi.db.query('api::employee.employee').findOne({

      where: { documentId },

      select: ['id'],

    })

    if (!existing) return ctx.notFound()



    const roleType = await resolveRoleType(strapi, user)

    const allowed = await canAccessEmployee(

      strapi,

      roleType,

      user.id,

      existing.id as number,

    )

    if (!allowed) return ctx.forbidden()



    ctx.query.populate = { team: true, user: true }



    return await super.findOne(ctx)

  },



  async create(ctx) {

    const user = ctx.state.user as { id: number } | undefined

    if (!user) return ctx.unauthorized()



    const body = ctx.request.body as { data?: Record<string, unknown> }

    const roleType = await resolveRoleType(strapi, user)

    const teamId = body?.data ? extractRelationId(body.data, 'team') : null

    const linkedUserId = body?.data ? extractRelationId(body.data, 'user') : null



    if (roleType === 'team_leader' || roleType === 'department_manager') {

      const allowed = await canAssignEmployeeToTeam(strapi, roleType, user.id, teamId)

      if (!allowed) return ctx.forbidden('Employee must belong to an authorized team')

    }



    if (body?.data) {

      body.data.daily_capacity = normalizeCapacity(body.data.daily_capacity ?? DEFAULT_CAPACITY)

      await overlayEmployeeIdentityFromUser(strapi, body.data)

      if (typeof body.data.email === 'string') {

        body.data.email = body.data.email.trim().toLowerCase()

      }

      if (body.data.employee_number !== undefined) {

        body.data.employee_number = normalizeEmployeeNumber(body.data.employee_number)

      } else {

        body.data.employee_number = null

      }

      const duplicateEmail = await findDuplicateEmployeeEmail(strapi, body.data.email)

      if (duplicateEmail) return ctx.badRequest(duplicateEmail)

      const duplicateNumber = await findDuplicateEmployeeNumber(strapi, body.data.employee_number)

      if (duplicateNumber) return ctx.badRequest(duplicateNumber)

      delete body.data.user

      delete body.data.team

    }

    const result = await super.create(ctx)

    const documentId = resultDocumentId(result)

    await persistUserRelation(strapi, 'api::employee.employee', documentId, 'user', linkedUserId)

    await persistUserRelation(strapi, 'api::employee.employee', documentId, 'team', teamId)

    return result

  },



  async update(ctx) {

    const user = ctx.state.user as { id: number } | undefined

    if (!user) return ctx.unauthorized()



    const documentId = ctx.params.id as string

    const body = ctx.request.body as { data?: Record<string, unknown> }



    const existing = await strapi.db.query('api::employee.employee').findOne({

      where: { documentId },

      populate: ['team'],

      select: ['id'],

    })

    if (!existing) return ctx.notFound()



    const roleType = await resolveRoleType(strapi, user)

    const allowed = await canAccessEmployee(

      strapi,

      roleType,

      user.id,

      existing.id as number,

    )

    if (!allowed) return ctx.forbidden()



    const linkedUserId = body?.data ? extractRelationId(body.data, 'user') : null

    const teamId = body?.data ? extractRelationId(body.data, 'team') : null



    if (body?.data && (roleType === 'team_leader' || roleType === 'department_manager')) {

      const assignedTeamId = teamId ?? (existing.team?.id as number | undefined) ?? null

      const teamAllowed = await canAssignEmployeeToTeam(strapi, roleType, user.id, assignedTeamId)

      if (!teamAllowed) return ctx.forbidden('Employee must belong to an authorized team')

    }



    if (body?.data && body.data.daily_capacity !== undefined) {

      body.data.daily_capacity = normalizeCapacity(body.data.daily_capacity)

    }



    if (body?.data) {

      await overlayEmployeeIdentityFromUser(strapi, body.data)

      if (typeof body.data.email === 'string') {

        body.data.email = body.data.email.trim().toLowerCase()

      }

      if (body.data.employee_number !== undefined) {

        body.data.employee_number = normalizeEmployeeNumber(body.data.employee_number)

      }

      const duplicateEmail = await findDuplicateEmployeeEmail(

        strapi,

        body.data.email,

        existing.id as number,

      )

      if (duplicateEmail) return ctx.badRequest(duplicateEmail)

      const duplicateNumber = await findDuplicateEmployeeNumber(

        strapi,

        body.data.employee_number,

        existing.id as number,

      )

      if (duplicateNumber) return ctx.badRequest(duplicateNumber)

      delete body.data.user

      delete body.data.team

    }



    const result = await super.update(ctx)

    const updatedDocumentId = resultDocumentId(result) ?? (ctx.params.id as string)

    await persistUserRelation(strapi, 'api::employee.employee', updatedDocumentId, 'user', linkedUserId)

    await persistUserRelation(strapi, 'api::employee.employee', updatedDocumentId, 'team', teamId)

    return result

  },

}))



/**
 * Custom allocation routes: capacity, grid, copy.
 */
import type { Core } from '@strapi/strapi'
import { computeCapacity } from '../capacity/calculate'
import { copyAllocations } from './copy'
import {
  ensureEmployeeForUser,
  findDepartmentIdsForManager,
  findEmployeeIdForUser,
  findEmployeeIdsInTeams,
  findTeamIdsForLeader,
  findTeamIdsInDepartments,
} from '../../utils/employee-scope'
import { resolveRoleType } from '../../utils/resolve-role-type'

export function registerAllocationRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/capacity',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const query = ctx.query as {
            from?: string
            to?: string
            employee?: string
            team?: string
          }

          if (!query.from || !query.to) {
            return ctx.badRequest('from and to query params are required (YYYY-MM-DD)')
          }

          const roleType = await resolveRoleType(strapi, user)

          if (roleType === 'employee') {
            await ensureEmployeeForUser(strapi, user.id)
          }

          const result = await computeCapacity(strapi, {
            from: query.from,
            to: query.to,
            employeeIds: query.employee ? [Number(query.employee)] : undefined,
            teamId:
              roleType === 'employee'
                ? undefined
                : query.team
                  ? Number(query.team)
                  : undefined,
            userId: user.id,
            roleType,
          })

          ctx.body = { data: result }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'GET',
        path: '/allocations/grid',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const query = ctx.query as {
            from?: string
            to?: string
            team?: string
          }
          if (!query.from || !query.to) {
            return ctx.badRequest('from and to are required')
          }

          const roleType = await resolveRoleType(strapi, user)
          const allocWhere: Record<string, unknown> = {
            allocation_date: { $gte: query.from, $lte: query.to },
          }

          if (roleType === 'employee') {
            const employeeId =
              (await findEmployeeIdForUser(strapi, user.id)) ??
              (await ensureEmployeeForUser(strapi, user.id))
            allocWhere.employee = employeeId ?? { id: { $in: [] } }
          } else if (roleType === 'team_leader') {
            const teamIds = await findTeamIdsForLeader(strapi, user.id)
            const employeeIds = await findEmployeeIdsInTeams(strapi, teamIds)
            allocWhere.employee = employeeIds.length
              ? { id: { $in: employeeIds } }
              : { id: { $in: [] } }
          } else if (roleType === 'department_manager') {
            const departmentIds = await findDepartmentIdsForManager(strapi, user.id)
            const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
            const employeeIds = await findEmployeeIdsInTeams(strapi, teamIds)
            allocWhere.employee = employeeIds.length
              ? { id: { $in: employeeIds } }
              : { id: { $in: [] } }
          } else if (query.team) {
            allocWhere.employee = { team: Number(query.team) }
          }

          const [capacity, allocations] = await Promise.all([
            computeCapacity(strapi, {
              from: query.from,
              to: query.to,
              teamId:
                roleType === 'employee'
                  ? undefined
                  : query.team
                    ? Number(query.team)
                    : undefined,
              userId: user.id,
              roleType,
            }),
            strapi.db.query('api::allocation.allocation').findMany({
              where: allocWhere,
              populate: ['employee', 'project'],
              orderBy: [{ allocation_date: 'asc' }],
            }),
          ])

          ctx.body = {
            data: {
              capacity,
              allocations: allocations.map(
                (a: {
                  id: number
                  documentId: string
                  allocation_date: string
                  hours: number
                  notes?: string
                  status: string
                  employee?: { id: number; full_name?: string; documentId?: string }
                  project?: { id: number; name?: string; code?: string; documentId?: string }
                }) => ({
                  id: a.id,
                  documentId: a.documentId,
                  allocation_date: a.allocation_date,
                  hours: Number(a.hours),
                  notes: a.notes,
                  status: a.status,
                  employee_id: a.employee?.id,
                  employee_name: a.employee?.full_name,
                  employee_document_id: a.employee?.documentId,
                  project_id: a.project?.id,
                  project_name: a.project?.name,
                  project_code: a.project?.code,
                  project_document_id: a.project?.documentId,
                }),
              ),
            },
          }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'POST',
        path: '/allocations/copy',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const body = ctx.request.body as {
            target_date?: string
            mode?: 'yesterday' | 'previous_week'
            employee_ids?: number[]
          }

          if (!body.target_date || !body.mode) {
            return ctx.badRequest('target_date and mode (yesterday|previous_week) are required')
          }

          const result = await copyAllocations(strapi, {
            targetDate: body.target_date,
            mode: body.mode,
            employeeIds: body.employee_ids,
            userId: user.id,
          })

          ctx.body = { data: result }
        },
        config: { auth: { scope: [] } },
      },
    ],
  })
}

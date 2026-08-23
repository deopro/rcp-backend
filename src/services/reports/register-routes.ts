/**
 * Reports export API.
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'
import { buildReport } from './build'
import { exportReport } from './export'
import { isReportFormat, isReportType } from './types'

const REPORT_ROLES = ['administrator', 'executive', 'department_manager', 'team_leader'] as const

function num(value?: string): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function canExport(roleType: string | null): boolean {
  return Boolean(roleType && REPORT_ROLES.includes(roleType as (typeof REPORT_ROLES)[number]))
}

export function registerReportRoutes(strapi: Core.Strapi) {
  strapi.server.routes({
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/reports/types',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number } | undefined
          if (!user) return ctx.unauthorized()

          const roleType = await resolveRoleType(strapi, user)
          if (!canExport(roleType)) return ctx.forbidden()

          ctx.body = {
            data: [
              'monthly-capacity',
              'employee-allocation',
              'project-allocation',
              'team',
              'department',
              'executive',
              'utilization',
              'bench',
              'skills',
              'forecast',
            ],
          }
        },
        config: { auth: { scope: [] } },
      },
      {
        method: 'GET',
        path: '/reports/:type',
        info: {},
        handler: async (ctx) => {
          const user = ctx.state.user as { id: number; preferred_locale?: string } | undefined
          if (!user) return ctx.unauthorized()

          const roleType = await resolveRoleType(strapi, user)
          if (!canExport(roleType)) return ctx.forbidden()

          const { type } = ctx.params as { type: string }
          if (!isReportType(type)) {
            return ctx.badRequest(`Unknown report type: ${type}`)
          }

          const query = ctx.query as {
            format?: string
            locale?: string
            from?: string
            to?: string
            department?: string
            team?: string
            project?: string
            employee?: string
            scope?: string
            granularity?: string
          }

          if (!query.from || !query.to) {
            return ctx.badRequest('from and to query params are required (YYYY-MM-DD)')
          }

          const format = query.format || 'xlsx'
          if (!isReportFormat(format)) {
            return ctx.badRequest('format must be xlsx, csv, or pdf')
          }

          const locale = query.locale || user.preferred_locale || 'en'

          const document = await buildReport(strapi, type, {
            from: query.from,
            to: query.to,
            locale,
            userId: user.id,
            roleType,
            departmentId: num(query.department),
            teamId: num(query.team),
            projectId: num(query.project),
            employeeId: num(query.employee),
            scope: query.scope as 'org' | 'department' | 'team' | 'project' | undefined,
            granularity: query.granularity as 'day' | 'week' | 'month' | undefined,
          })

          const exported = await exportReport(document, format)

          ctx.set('Content-Type', exported.contentType)
          ctx.set('Content-Disposition', `attachment; filename="${exported.filename}"`)
          ctx.body = exported.buffer
        },
        config: { auth: { scope: [] } },
      },
    ],
  })
}

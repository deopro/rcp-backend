/**
 * Approval workflow action routes.
 */
import type { Core } from '@strapi/strapi'
import { resolveRoleType } from '../../utils/resolve-role-type'
import { transitionApproval, type ApprovalStatus } from './workflow'

async function canActOnApproval(
  strapi: Core.Strapi,
  userId: number,
  roleType: string | null,
  approval: { team?: { id?: number; team_leader?: { id?: number }; department?: { manager?: { id?: number } } } },
  action: 'submit' | 'return' | 'approve' | 'lock' | 'reopen',
): Promise<boolean> {
  if (roleType === 'administrator') return true

  const teamId = approval.team?.id
  if (!teamId) return false

  const team = await strapi.db.query('api::team.team').findOne({
    where: { id: teamId },
    populate: ['team_leader', 'department.manager'],
  })
  if (!team) return false

  const isLeader = team.team_leader?.id === userId
  const isManager = team.department?.manager?.id === userId

  if (roleType === 'team_leader' && isLeader) {
    return ['submit', 'return', 'approve', 'lock'].includes(action)
  }
  if (roleType === 'department_manager' && isManager) {
    return ['submit', 'return', 'approve', 'lock', 'reopen'].includes(action)
  }
  return false
}

export function registerApprovalRoutes(strapi: Core.Strapi) {
  const actions: { path: string; to: ApprovalStatus; action: 'submit' | 'return' | 'approve' | 'lock' | 'reopen' }[] = [
    { path: '/approvals/:documentId/submit', to: 'submitted', action: 'submit' },
    { path: '/approvals/:documentId/return', to: 'returned', action: 'return' },
    { path: '/approvals/:documentId/approve', to: 'approved', action: 'approve' },
    { path: '/approvals/:documentId/lock', to: 'locked', action: 'lock' },
    { path: '/approvals/:documentId/reopen', to: 'draft', action: 'reopen' },
  ]

  strapi.server.routes({
    type: 'content-api',
    routes: actions.map(({ path, to, action }) => ({
      method: 'POST',
      path,
      info: {},
      handler: async (ctx) => {
        const user = ctx.state.user as { id: number } | undefined
        if (!user) return ctx.unauthorized()

        const { documentId } = ctx.params as { documentId: string }
        const body = ctx.request.body as { comments?: string }

        const approval = await strapi.db.query('api::approval.approval').findOne({
          where: { documentId },
          populate: ['team'],
        })
        if (!approval) return ctx.notFound()

        const roleType = await resolveRoleType(strapi, user)
        const allowed = await canActOnApproval(strapi, user.id, roleType, approval, action)
        if (!allowed) return ctx.forbidden()

        if (action === 'return' && !body?.comments?.trim()) {
          return ctx.badRequest('comments are required when returning an approval')
        }

        const result = await transitionApproval(strapi, {
          documentId,
          to,
          userId: user.id,
          comments: body?.comments,
        })

        if (result.error === 'not_found') return ctx.notFound()
        if (result.error === 'invalid_transition') {
          return ctx.badRequest(`Cannot transition from ${result.from} to ${result.to}`)
        }

        ctx.body = {
          data: result.approval,
          meta: { allocations_updated: result.allocationsUpdated || 0 },
        }
      },
      config: { auth: { scope: [] } },
    })),
  })
}

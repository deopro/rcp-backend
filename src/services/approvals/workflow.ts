/**
 * Approval workflow transitions.
 */
import type { Core } from '@strapi/strapi'
import { markAllocationsSubmitted } from './lock'

export type ApprovalStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'locked'

const TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  draft: ['submitted'],
  submitted: ['returned', 'approved'],
  returned: ['submitted'],
  approved: ['locked'],
  locked: ['draft'],
}

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to)
}

export async function transitionApproval(
  strapi: Core.Strapi,
  opts: {
    documentId: string
    to: ApprovalStatus
    userId: number
    comments?: string
  },
) {
  const approval = await strapi.db.query('api::approval.approval').findOne({
    where: { documentId: opts.documentId },
    populate: ['team'],
  })
  if (!approval) return { error: 'not_found' as const }

  const from = approval.status as ApprovalStatus
  if (!canTransition(from, opts.to)) {
    return { error: 'invalid_transition' as const, from, to: opts.to }
  }

  const data: Record<string, unknown> = { status: opts.to }

  if (opts.comments !== undefined) {
    data.comments = opts.comments
  }

  const now = new Date().toISOString()

  if (opts.to === 'submitted') {
    data.submitted_by = opts.userId
    data.submitted_at = now
    data.returned_at = null
  }
  if (opts.to === 'returned') {
    data.returned_at = now
    data.approved_by = null
    data.approved_at = null
  }
  if (opts.to === 'approved') {
    data.approved_by = opts.userId
    data.approved_at = now
  }
  if (opts.to === 'locked') {
    data.locked_by = opts.userId
    data.locked_at = now
  }
  if (opts.to === 'draft' && from === 'locked') {
    // reopen
    data.locked_by = null
    data.locked_at = null
    data.approved_by = null
    data.approved_at = null
    data.submitted_by = null
    data.submitted_at = null
  }

  const updated = await strapi.db.query('api::approval.approval').update({
    where: { documentId: opts.documentId },
    data,
    populate: ['team', 'submitted_by', 'approved_by', 'locked_by'],
  })

  let allocationsUpdated = 0
  if (opts.to === 'submitted' && approval.team?.id) {
    allocationsUpdated = await markAllocationsSubmitted(
      strapi,
      approval.team.id,
      approval.period_start,
      approval.period_end,
    )
  }

  return { approval: updated, allocationsUpdated }
}

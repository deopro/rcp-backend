/**
 * Approval workflow → notification fan-out.
 */
import type { Core } from '@strapi/strapi'
import { createNotification } from './create'
import type { NotificationType } from './types'

async function teamLeaderUserId(strapi: Core.Strapi, teamId: number): Promise<number | null> {
  const team = await strapi.db.query('api::team.team').findOne({
    where: { id: teamId },
    populate: ['team_leader'],
  })
  return (team?.team_leader?.id as number | undefined) ?? null
}

async function departmentManagerUserId(strapi: Core.Strapi, teamId: number): Promise<number | null> {
  const team = await strapi.db.query('api::team.team').findOne({
    where: { id: teamId },
    populate: ['department.manager'],
  })
  return (team?.department?.manager?.id as number | undefined) ?? null
}

function periodLabel(start: string, end: string): string {
  return `${String(start).slice(0, 10)} → ${String(end).slice(0, 10)}`
}

export async function notifyApprovalTransition(
  strapi: Core.Strapi,
  opts: {
    action: 'submit' | 'return' | 'approve' | 'lock' | 'reopen'
    approval: {
      documentId: string
      period_start: string
      period_end: string
      team?: { id?: number; name?: string }
      submitted_by?: { id?: number } | number | null
    }
    actorUserId: number
    comments?: string
  },
): Promise<void> {
  const teamId = opts.approval.team?.id
  if (!teamId) return

  const teamName = opts.approval.team?.name || ''
  const period = periodLabel(opts.approval.period_start, opts.approval.period_end)
  const comments = opts.comments?.trim() || ''
  const payload = {
    approval_document_id: opts.approval.documentId,
    team_id: teamId,
    team_name: teamName,
    period_start: opts.approval.period_start,
    period_end: opts.approval.period_end,
    comments,
    link: '/approvals',
  }

  const recipients = new Set<number>()
  const leaderId = await teamLeaderUserId(strapi, teamId)
  const managerId = await departmentManagerUserId(strapi, teamId)
  const submittedBy =
    typeof opts.approval.submitted_by === 'object'
      ? opts.approval.submitted_by?.id
      : opts.approval.submitted_by

  let type: NotificationType
  let title: string
  let body: string

  switch (opts.action) {
    case 'submit':
      type = 'approval_request'
      title = `Approval submitted — ${teamName}`
      body = `Period ${period} is awaiting review.`
      if (managerId) recipients.add(managerId)
      if (leaderId && leaderId !== opts.actorUserId) recipients.add(leaderId)
      break
    case 'return':
      type = 'approval_returned'
      title = `Approval returned — ${teamName}`
      body = comments
        ? `Period ${period}: ${comments}`
        : `Period ${period} was returned for changes.`
      if (leaderId) recipients.add(leaderId)
      if (submittedBy) recipients.add(submittedBy)
      break
    case 'approve':
      type = 'approval_approved'
      title = `Approval approved — ${teamName}`
      body = `Period ${period} was approved.`
      if (leaderId) recipients.add(leaderId)
      if (submittedBy) recipients.add(submittedBy)
      break
    case 'lock':
      type = 'approval_locked'
      title = `Period locked — ${teamName}`
      body = `Allocations for ${period} are now locked.`
      if (leaderId) recipients.add(leaderId)
      if (managerId) recipients.add(managerId)
      break
    case 'reopen':
      type = 'approval_reopened'
      title = `Period reopened — ${teamName}`
      body = `Allocations for ${period} can be edited again.`
      if (leaderId) recipients.add(leaderId)
      break
    default:
      return
  }

  recipients.delete(opts.actorUserId)

  await Promise.all(
    [...recipients].map((userId) =>
      createNotification(strapi, {
        userId,
        type,
        title,
        body,
        payload,
        dedupeKey: `${type}:${opts.approval.documentId}`,
      }),
    ),
  )
}

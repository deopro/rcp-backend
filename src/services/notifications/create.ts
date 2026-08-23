/**
 * Create in-app notifications and fan out to email/push channels.
 */
import type { Core } from '@strapi/strapi'
import { createEmailProvider } from './email-provider'
import { createPushProvider } from './push-provider'
import type { CreateNotificationInput, NotificationChannels, NotificationDto } from './types'

function toDto(row: Record<string, unknown>): NotificationDto {
  return {
    id: row.id as number,
    document_id: row.documentId as string,
    type: row.type as NotificationDto['type'],
    title: row.title as string,
    body: (row.body as string) || null,
    payload: (row.payload as Record<string, unknown>) || null,
    read_at: (row.read_at as string) || null,
    created_at: (row.createdAt as string) || undefined,
    channels: (row.channels as NotificationChannels) || null,
  }
}

async function hasRecentDedupe(
  strapi: Core.Strapi,
  userId: number,
  type: string,
  dedupeKey: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const rows = await strapi.db.query('api::notification.notification').findMany({
    where: {
      user: userId,
      type,
      createdAt: { $gte: since },
      read_at: { $null: true },
    },
    limit: 50,
  })
  return rows.some((row: { payload?: { dedupe_key?: string } }) => row.payload?.dedupe_key === dedupeKey)
}

export async function createNotification(
  strapi: Core.Strapi,
  input: CreateNotificationInput,
): Promise<NotificationDto | null> {
  if (input.dedupeKey) {
    const exists = await hasRecentDedupe(strapi, input.userId, input.type, input.dedupeKey)
    if (exists) return null
  }

  const payload = {
    ...(input.payload || {}),
    ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
  }

  const channels: NotificationChannels = { in_app: true }

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: input.userId },
    select: ['id', 'email'],
  })

  const email = createEmailProvider()
  if (email.isConfigured() && user?.email) {
    const result = await email.send({
      to: user.email,
      subject: input.title,
      text: input.body || input.title,
    })
    channels.email = result.ok ? 'sent' : 'failed'
  } else {
    channels.email = 'skipped'
  }

  const push = createPushProvider()
  if (push.isConfigured()) {
    const result = await push.send({
      userId: input.userId,
      title: input.title,
      body: input.body || input.title,
      data: payload,
    })
    channels.push = result.ok ? 'sent' : 'failed'
  } else {
    channels.push = 'skipped'
  }

  const created = await strapi.db.query('api::notification.notification').create({
    data: {
      user: input.userId,
      type: input.type,
      title: input.title,
      body: input.body || null,
      payload,
      channels,
      read_at: null,
    },
  })

  return toDto(created as Record<string, unknown>)
}

export async function listNotifications(
  strapi: Core.Strapi,
  userId: number,
  opts?: { unreadOnly?: boolean; limit?: number },
): Promise<{ items: NotificationDto[]; unread_count: number }> {
  const where: Record<string, unknown> = { user: userId }
  if (opts?.unreadOnly) where.read_at = { $null: true }

  const items = await strapi.db.query('api::notification.notification').findMany({
    where,
    orderBy: { createdAt: 'desc' },
    limit: opts?.limit || 50,
  })

  const unread_count = await strapi.db.query('api::notification.notification').count({
    where: { user: userId, read_at: { $null: true } },
  })

  return {
    items: items.map((row: Record<string, unknown>) => toDto(row)),
    unread_count,
  }
}

export async function markRead(
  strapi: Core.Strapi,
  userId: number,
  documentId: string,
): Promise<NotificationDto | null> {
  const existing = await strapi.db.query('api::notification.notification').findOne({
    where: { documentId, user: userId },
  })
  if (!existing) return null

  if (existing.read_at) return toDto(existing as Record<string, unknown>)

  const updated = await strapi.db.query('api::notification.notification').update({
    where: { id: existing.id },
    data: { read_at: new Date().toISOString() },
  })
  return toDto(updated as Record<string, unknown>)
}

export async function markAllRead(strapi: Core.Strapi, userId: number): Promise<number> {
  const unread = await strapi.db.query('api::notification.notification').findMany({
    where: { user: userId, read_at: { $null: true } },
    select: ['id'],
    limit: 500,
  })

  const now = new Date().toISOString()
  for (const row of unread) {
    await strapi.db.query('api::notification.notification').update({
      where: { id: row.id },
      data: { read_at: now },
    })
  }
  return unread.length
}

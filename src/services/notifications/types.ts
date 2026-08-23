export type NotificationType =
  | 'approval_request'
  | 'approval_returned'
  | 'approval_approved'
  | 'approval_locked'
  | 'approval_reopened'
  | 'capacity_alert'
  | 'over_allocation'
  | 'bench_alert'
  | 'missing_allocation'

export type NotificationChannels = {
  in_app: boolean
  email?: 'sent' | 'skipped' | 'failed'
  push?: 'sent' | 'skipped' | 'failed'
}

export type CreateNotificationInput = {
  userId: number
  type: NotificationType
  title: string
  body?: string
  payload?: Record<string, unknown>
  /** Deduplicate key — skip if unread with same type+dedupeKey exists */
  dedupeKey?: string
}

export type NotificationDto = {
  id: number
  document_id: string
  type: NotificationType
  title: string
  body?: string | null
  payload?: Record<string, unknown> | null
  read_at?: string | null
  created_at?: string
  channels?: NotificationChannels | null
}
